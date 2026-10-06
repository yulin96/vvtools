import { createRequire } from 'module'
import { readFile } from 'fs/promises'
import { extname } from 'path'
import type { FontInstance, FontOptions } from '../../shared/types'
const require = createRequire(import.meta.url)

interface FontVariationAxis {
  min: number
  default: number
  max: number
}

interface FontLike {
  variationAxes?: Record<string, FontVariationAxis>
  namedVariations?: Record<string, Record<string, number>>
}

interface FontCollection extends FontLike {
  fonts: FontLike[]
}

interface Fontkit {
  create(buffer: Uint8Array): FontLike | FontCollection
}

const fontkit = require('fontkit') as Fontkit

export interface FontProbe {
  format: string
  fontCount: number
  fontInstances: FontInstance[]
}

export async function probeFontCore(sourcePath: string, options: FontOptions): Promise<FontProbe> {
  const buffer = await readFile(sourcePath)
  const parsed = fontkit.create(buffer)
  const fonts = isCollection(parsed) ? parsed.fonts : [parsed]
  if (fonts.length === 0) throw new Error('字体文件中没有可处理的字体')
  const fontInstances =
    options.operation === 'variableStatic'
      ? options.variableInstanceMode === 'default'
        ? getDefaultFontInstance(fonts[0])
        : getFontInstances(fonts[0])
      : []
  return {
    format: fontFormatFromPath(sourcePath),
    fontCount: fonts.length,
    fontInstances
  }
}

function getFontInstances(font: FontLike): FontInstance[] {
  let namedVariations: Record<string, Record<string, number>> = {}
  try {
    namedVariations = font.namedVariations ?? {}
  } catch {
    // Some system variable fonts expose malformed named-instance records; use default axes below.
  }
  const named = Object.entries(namedVariations).map(([name, axes]) => ({
    name,
    axes: { ...axes }
  }))
  if (named.length > 0) return named
  const axes = Object.fromEntries(
    Object.entries(font.variationAxes ?? {}).map(([tag, axis]) => [tag, axis.default])
  )
  return Object.keys(axes).length > 0 ? [{ name: '默认实例', axes }] : []
}

function getDefaultFontInstance(font: FontLike): FontInstance[] {
  const axes = Object.fromEntries(
    Object.entries(font.variationAxes ?? {}).map(([tag, axis]) => [tag, axis.default])
  )
  return Object.keys(axes).length > 0 ? [{ name: '默认实例', axes }] : []
}

function isCollection(value: FontLike | FontCollection): value is FontCollection {
  return Array.isArray((value as FontCollection).fonts)
}

function fontFormatFromPath(sourcePath: string): string {
  const extension = extname(sourcePath).toLowerCase()
  return extension ? extension.slice(1).toUpperCase() : '字体'
}
