import { createRequire } from 'module'
import { createFont } from 'fonteditor-core'
import { create } from 'fontkit'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runFontProcess } from '../src/main/media/font-process'
import {
  getFonttoolsDirectory,
  inspectFonttoolsRuntime,
  inspectQpdfRuntime
} from '../src/main/media/ffmpeg-runtime'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

const require = createRequire(import.meta.url)
const directories: string[] = []

afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})

describe('bundled PDF and font runtimes', () => {
  it('reports the versions of the engines that actually initialize', async () => {
    await expect(inspectQpdfRuntime()).resolves.toEqual({
      available: true,
      version: 'qpdf version 12.4.2'
    })
    await expect(inspectFonttoolsRuntime()).resolves.toEqual({
      available: true,
      version: '4.66.1 (Pyodide)'
    })
  })

  it('subsets a real font and writes WOFF2 with only the requested character', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vvtools-font-runtime-'))
    directories.push(root)
    const sourcePath = join(root, '源 字体.ttf')
    const outputPath = join(root, '输出 字体.woff2')
    const font = createFont().get()
    const glyph = font.glyf[0]
    font.glyf = [
      glyph,
      { ...structuredClone(glyph), name: 'A', unicode: [0x41] },
      { ...structuredClone(glyph), name: 'B', unicode: [0x42] }
    ]
    await writeFile(sourcePath, Buffer.from(createFont(font).write({ type: 'ttf' }) as ArrayBuffer))
    const source = create(await readFile(sourcePath))
    expect(
      source.characterSet.filter((codePoint: number) => source.hasGlyphForCodePoint(codePoint))
    ).toEqual([0x41, 0x42])

    const size = await runFontProcess(
      { sourcePath, outputPath, subsetOptions: { text: 'A', flavor: 'woff2' } },
      new AbortController().signal,
      getFonttoolsDirectory()
    )

    const output = await readFile(outputPath)
    expect(size).toBe(output.byteLength)
    expect(output.subarray(0, 4).toString()).toBe('wOF2')
    const subset = create(output)
    expect(
      subset.characterSet.filter((codePoint: number) => subset.hasGlyphForCodePoint(codePoint))
    ).toEqual([0x41])
    expect(subset.numGlyphs).toBe(2)
  })

  it('instantiates a real variable font and removes its variation axes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vvtools-font-variable-'))
    directories.push(root)
    const packageDirectory = getFonttoolsDirectory()
    const { createPyodide, installPackages } = require('@web-alchemy/fonttools/src/pyodide.js')
    const pyodide = await createPyodide({
      lockFileURL: join(packageDirectory, 'pyodide-lock.json'),
      packageCacheDir: packageDirectory,
      packageBaseUrl: packageDirectory + '/',
      stdout: () => undefined
    })
    await installPackages(pyodide, { messageCallback: () => undefined })
    pyodide.runPython(`
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

fb = FontBuilder(1000, isTTF=True)
fb.setupGlyphOrder(['.notdef', 'A'])
fb.setupCharacterMap({65: 'A'})
fb.setupGlyf({name: TTGlyphPen(None).glyph() for name in ['.notdef', 'A']})
fb.setupHorizontalMetrics({'.notdef': (500, 0), 'A': (600, 0)})
fb.setupHorizontalHeader(ascent=800, descent=-200)
fb.setupNameTable({'familyName': 'Fixture', 'styleName': 'Regular'})
fb.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
fb.setupPost()
fb.setupFvar([('wght', 100, 400, 900, 'Weight')], [])
fb.setupGvar({'.notdef': [], 'A': []})
fb.save('/variable.ttf')
`)
    const sourcePath = join(root, 'variable.ttf')
    const outputPath = join(root, 'static.ttf')
    await writeFile(sourcePath, pyodide.FS.readFile('/variable.ttf'))
    expect(create(await readFile(sourcePath)).variationAxes).toMatchObject({
      wght: { min: 100, default: 400, max: 900 }
    })

    await runFontProcess(
      {
        sourcePath,
        outputPath,
        staticAxes: { wght: [400, 400] },
        subsetOptions: { '*': true, 'layout-features': '*' }
      },
      new AbortController().signal,
      getFonttoolsDirectory()
    )

    const output = create(await readFile(outputPath))
    expect(output.variationAxes).toEqual({})
    expect(
      output.characterSet.filter((codePoint: number) => output.hasGlyphForCodePoint(codePoint))
    ).toEqual([0x41])
    expect(output.glyphForCodePoint(0x41).advanceWidth).toBe(600)
  })
})
