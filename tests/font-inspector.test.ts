import { describe, expect, it } from 'vitest'
import { createFont, woff2, type FontEditor } from 'fonteditor-core'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  applyFontEdits,
  inspectFontFile,
  saveEditedFontFile,
  validateFontEditValues
} from '../src/main/media/font-inspector'
import {
  filterFontCodePoints,
  formatUnicode,
  parseCharacterQuery
} from '../src/renderer/src/lib/font-inspector'

describe('font inspector', () => {
  it('applies global glyph transforms and font metrics', () => {
    const font = createFont().get()
    const original = structuredClone(font.glyf[0])

    applyFontEdits(font, {
      unitsPerEm: 1024,
      offsetX: 10,
      offsetY: 20,
      scaleX: 2,
      scaleY: 0.5,
      skewX: 0,
      advanceWidthDelta: 12,
      ascent: 900,
      descent: -240,
      lineGap: 80,
      xHeight: 500,
      capHeight: 700
    })

    expect(font.glyf[0].xMin).toBe(original.xMin * 2 + 10)
    expect(font.glyf[0].yMax).toBe(original.yMax * 0.5 + 20)
    expect(font.glyf[0].advanceWidth).toBe(original.advanceWidth * 2 + 12)
    expect(font.hhea).toMatchObject({ ascent: 900, descent: -240, lineGap: 80 })
    expect(font['OS/2']).toMatchObject({
      sTypoAscender: 900,
      sTypoDescender: -240,
      sTypoLineGap: 80,
      sxHeight: 500,
      sCapHeight: 700
    })
  })

  it('validates edit limits from the source units per em', () => {
    expect(() =>
      validateFontEditValues({
        unitsPerEm: 1000,
        offsetX: 0,
        offsetY: 0,
        scaleX: 1,
        scaleY: 1,
        skewX: 46,
        advanceWidthDelta: 0,
        ascent: 800,
        descent: -200,
        lineGap: 0,
        xHeight: 500,
        capHeight: 700
      })
    ).toThrow('skewX')
  })

  it('inspects and saves an edited static TrueType font', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vvtools-font-inspector-'))
    const sourcePath = join(directory, 'source.ttf')
    const outputPath = join(directory, 'edited.ttf')
    try {
      const source = createFont()
      const data = source.get()
      data.glyf.push({ ...structuredClone(data.glyf[0]), name: 'A', unicode: [0x41] })
      source.set(data)
      await writeFile(sourcePath, source.write({ type: 'ttf', toBuffer: true }))

      const inspected = inspectFontFile(sourcePath)
      expect(inspected.codePoints).toContain(0x41)
      expect(inspected.editable).toBe(true)

      await saveEditedFontFile(sourcePath, outputPath, {
        ...inspected.metrics,
        offsetX: 0,
        offsetY: 40,
        scaleX: 1,
        scaleY: 1,
        skewX: 0,
        advanceWidthDelta: 0
      })
      const saved = createFont(await readFile(outputPath), { type: 'ttf' }).get()
      expect(saved.glyf.find((glyph) => glyph.unicode?.includes(0x41))?.yMin).toBe(
        data.glyf.find((glyph) => glyph.unicode?.includes(0x41))!.yMin + 40
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it.each(['woff', 'woff2'] as FontEditor.FontType[])(
    'saves an edited %s web font',
    async (format) => {
      const directory = await mkdtemp(join(tmpdir(), 'vvtools-font-inspector-'))
      const sourcePath = join(directory, `source.${format}`)
      const outputPath = join(directory, `edited.${format}`)
      try {
        if (format === 'woff2' && !woff2.isInited()) await woff2.init()
        const source = createFont()
        await writeFile(sourcePath, source.write({ type: format, toBuffer: true }))
        const inspected = inspectFontFile(sourcePath)

        await saveEditedFontFile(sourcePath, outputPath, {
          ...inspected.metrics,
          offsetX: 0,
          offsetY: 20,
          scaleX: 1,
          scaleY: 1,
          skewX: 0,
          advanceWidthDelta: 0
        })

        expect((await readFile(outputPath)).byteLength).toBeGreaterThan(0)
        expect(inspectFontFile(outputPath).format).toBe(format)
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    }
  )

  it('searches only code points that the font contains', () => {
    const available = [0x41, 0x4e2d, 0x28ff]
    expect(parseCharacterQuery('A中缺')).toEqual([0x41, 0x4e2d, 0x7f3a])
    expect(parseCharacterQuery('U+0041, 0x28FF')).toEqual([0x41, 0x28ff])
    expect(filterFontCodePoints(available, 'A缺')).toEqual([0x41])
    expect(filterFontCodePoints(available, '缺')).toEqual([])
    expect(filterFontCodePoints(available, '')).toBe(available)
    expect(formatUnicode(0x28ff)).toBe('U+28FF')
  })
})
