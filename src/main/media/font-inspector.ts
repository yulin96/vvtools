import { createRequire } from 'module'
import { readFile, writeFile } from 'fs/promises'
import { statSync } from 'fs'
import { basename, extname } from 'path'
import { createFont, woff2, type FontEditor, type TTF } from 'fonteditor-core'
import type { FontEditValues, FontInspection, FontInspectionAxis } from '../../shared/types'
import { createFontPreviewUrl } from './font-preview-protocol'

const require = createRequire(import.meta.url)
const EDITABLE_FORMATS = new Set(['ttf', 'woff', 'woff2'])

interface FontVariationAxis {
  name?: string
  min: number
  default: number
  max: number
}

interface InspectedFont {
  postscriptName?: string
  fullName?: string
  familyName?: string
  subfamilyName?: string
  version?: string
  ascent: number
  descent: number
  lineGap: number
  capHeight: number
  xHeight: number
  numGlyphs: number
  unitsPerEm: number
  characterSet: number[]
  variationAxes?: Record<string, FontVariationAxis>
}

interface FontCollection {
  fonts: InspectedFont[]
}

interface Fontkit {
  openSync(path: string): InspectedFont | FontCollection
}

const fontkit = require('fontkit') as Fontkit

export function inspectFontFile(sourcePath: string): FontInspection {
  const parsed = fontkit.openSync(sourcePath)
  const fonts = isCollection(parsed) ? parsed.fonts : [parsed]
  const font = fonts[0]
  if (!font) throw new Error('字体文件中没有可检查的字体')

  const format = extname(sourcePath).slice(1).toLowerCase()
  const variationAxes = serializeVariationAxes(font.variationAxes)
  const readOnlyReason = resolveReadOnlyReason(format, fonts.length, variationAxes.length)
  const codePoints = [...new Set(font.characterSet)]
    .filter(isUnicodeScalar)
    .sort((left, right) => left - right)

  return {
    sourcePath,
    previewUrl: createFontPreviewUrl(sourcePath),
    fileName: basename(sourcePath),
    fileSize: statSync(sourcePath).size,
    format,
    familyName: cleanName(font.familyName),
    subfamilyName: cleanName(font.subfamilyName),
    fullName: cleanName(font.fullName),
    postscriptName: cleanName(font.postscriptName),
    version: cleanName(font.version),
    fontCount: fonts.length,
    glyphCount: finiteInteger(font.numGlyphs),
    codePoints,
    metrics: {
      unitsPerEm: positiveInteger(font.unitsPerEm, 1000),
      ascent: finiteInteger(font.ascent),
      descent: finiteInteger(font.descent),
      lineGap: finiteInteger(font.lineGap),
      xHeight: finiteInteger(font.xHeight),
      capHeight: finiteInteger(font.capHeight)
    },
    variationAxes,
    editable: !readOnlyReason,
    readOnlyReason
  }
}

export async function saveEditedFontFile(
  sourcePath: string,
  outputPath: string,
  edits: FontEditValues
): Promise<void> {
  const format = extname(sourcePath).slice(1).toLowerCase() as FontEditor.FontType
  if (extname(outputPath).toLowerCase() !== `.${format}`) {
    throw new Error('编辑后的字体必须保持原文件格式')
  }
  const parsed = fontkit.openSync(sourcePath)
  const fonts = isCollection(parsed) ? parsed.fonts : [parsed]
  if (!fonts[0]) throw new Error('字体文件中没有可编辑的字体')
  const reason = resolveReadOnlyReason(
    format,
    fonts.length,
    serializeVariationAxes(fonts[0]?.variationAxes).length
  )
  if (reason) throw new Error(reason)
  if (format === 'woff2' && !woff2.isInited()) await woff2.init()

  const input = await readFile(sourcePath)
  const font = createFont(input, {
    type: format,
    hinting: false,
    kerning: true,
    compound2simple: true
  })
  const data = font.get()
  applyFontEdits(data, edits)
  const output = font.write({ type: format, toBuffer: true, hinting: false, kerning: true })
  await writeFile(outputPath, output, { flag: 'wx' })
}

export function applyFontEdits(font: TTF.TTFObject, edits: FontEditValues): void {
  const skew = Math.tan((edits.skewX * Math.PI) / 180)
  let fontXMin = Number.POSITIVE_INFINITY
  let fontYMin = Number.POSITIVE_INFINITY
  let fontXMax = Number.NEGATIVE_INFINITY
  let fontYMax = Number.NEGATIVE_INFINITY

  for (const glyph of font.glyf) {
    if (glyph.contours?.length) {
      for (const contour of glyph.contours) {
        for (const point of contour) {
          const scaledY = point.y * edits.scaleY
          point.x = Math.round(point.x * edits.scaleX + scaledY * skew + edits.offsetX)
          point.y = Math.round(scaledY + edits.offsetY)
        }
      }
      updateGlyphBounds(glyph)
      fontXMin = Math.min(fontXMin, glyph.xMin)
      fontYMin = Math.min(fontYMin, glyph.yMin)
      fontXMax = Math.max(fontXMax, glyph.xMax)
      fontYMax = Math.max(fontYMax, glyph.yMax)
    }
    glyph.advanceWidth = Math.max(
      0,
      Math.round(glyph.advanceWidth * edits.scaleX + edits.advanceWidthDelta)
    )
  }

  if (Number.isFinite(fontXMin)) {
    font.head.xMin = fontXMin
    font.head.yMin = fontYMin
    font.head.xMax = fontXMax
    font.head.yMax = fontYMax
  }

  font.hhea.ascent = edits.ascent
  font.hhea.descent = edits.descent
  font.hhea.lineGap = edits.lineGap
  font['OS/2'].sTypoAscender = edits.ascent
  font['OS/2'].sTypoDescender = edits.descent
  font['OS/2'].sTypoLineGap = edits.lineGap
  font['OS/2'].usWinAscent = Math.max(edits.ascent, Number.isFinite(fontYMax) ? fontYMax : 0, 0)
  font['OS/2'].usWinDescent = Math.max(
    Math.abs(edits.descent),
    Number.isFinite(fontYMin) ? Math.abs(Math.min(fontYMin, 0)) : 0
  )
  font['OS/2'].sxHeight = edits.xHeight
  font['OS/2'].sCapHeight = edits.capHeight
  font.post.italicAngle -= edits.skewX
}

export function validateFontEditValues(value: unknown): FontEditValues {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('字体编辑参数无效')
  }
  const input = value as Record<string, unknown>
  const number = (key: keyof FontEditValues, minimum: number, maximum: number): number => {
    const current = input[key]
    if (
      typeof current !== 'number' ||
      !Number.isFinite(current) ||
      current < minimum ||
      current > maximum
    ) {
      throw new Error(`字体编辑参数无效：${key}`)
    }
    return current
  }
  const unitsPerEm = number('unitsPerEm', 64, 16_384)
  const result: FontEditValues = {
    unitsPerEm,
    offsetX: number('offsetX', -unitsPerEm * 4, unitsPerEm * 4),
    offsetY: number('offsetY', -unitsPerEm * 4, unitsPerEm * 4),
    scaleX: number('scaleX', 0.1, 4),
    scaleY: number('scaleY', 0.1, 4),
    skewX: number('skewX', -45, 45),
    advanceWidthDelta: number('advanceWidthDelta', -unitsPerEm, unitsPerEm * 4),
    ascent: number('ascent', 0, unitsPerEm * 4),
    descent: number('descent', -unitsPerEm * 4, 0),
    lineGap: number('lineGap', 0, unitsPerEm * 4),
    xHeight: number('xHeight', 0, unitsPerEm * 4),
    capHeight: number('capHeight', 0, unitsPerEm * 4)
  }
  return result
}

function updateGlyphBounds(glyph: TTF.Glyph): void {
  const points = glyph.contours.flat()
  glyph.xMin = Math.min(...points.map((point) => point.x))
  glyph.yMin = Math.min(...points.map((point) => point.y))
  glyph.xMax = Math.max(...points.map((point) => point.x))
  glyph.yMax = Math.max(...points.map((point) => point.y))
  glyph.leftSideBearing = glyph.xMin
}

function resolveReadOnlyReason(
  format: string,
  fontCount: number,
  axisCount: number
): string | undefined {
  if (fontCount > 1) return '字体集合首版仅支持检查和预览'
  if (axisCount > 0) return '可变字体首版仅支持检查和预览'
  if (!EDITABLE_FORMATS.has(format)) return 'OTF 字体首版仅支持检查和预览'
  return undefined
}

function serializeVariationAxes(
  axes: Record<string, FontVariationAxis> | undefined
): FontInspectionAxis[] {
  return Object.entries(axes ?? {}).map(([tag, axis]) => ({
    tag,
    name: cleanName(axis.name) || tag,
    min: axis.min,
    default: axis.default,
    max: axis.max
  }))
}

function isCollection(value: InspectedFont | FontCollection): value is FontCollection {
  return Array.isArray((value as FontCollection).fonts)
}

function isUnicodeScalar(value: number): boolean {
  return (
    Number.isInteger(value) && value >= 0 && value <= 0x10ffff && (value < 0xd800 || value > 0xdfff)
  )
}

function cleanName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function finiteInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0
}

function positiveInteger(value: unknown, fallback: number): number {
  const result = finiteInteger(value)
  return result > 0 ? result : fallback
}
