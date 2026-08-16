import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveFontSubsetText } from '../src/main/media/font-processor'
import { DEFAULT_FONT_OPTIONS } from '../src/shared/constants'
import {
  FONT_SUBSET_CHINESE_PRESETS,
  FONT_SUBSET_CHINESE_PUNCTUATION,
  FONT_SUBSET_LATIN_BASIC
} from '../src/shared/font-subset-presets'

describe('font subset presets', () => {
  let fixtureDirectory = ''

  beforeAll(async () => {
    fixtureDirectory = await mkdtemp(join(tmpdir(), 'vvtools-font-subset-'))
  })

  afterAll(async () => {
    await rm(fixtureDirectory, { recursive: true, force: true })
  })

  it('contains the three official Chinese character ranges without duplicates', () => {
    expect([...FONT_SUBSET_CHINESE_PRESETS['3500']]).toHaveLength(3500)
    expect([...FONT_SUBSET_CHINESE_PRESETS['6500']]).toHaveLength(6500)
    expect([...FONT_SUBSET_CHINESE_PRESETS['8105']]).toHaveLength(8105)
    expect(new Set(FONT_SUBSET_CHINESE_PRESETS['8105']).size).toBe(8105)
    expect(FONT_SUBSET_CHINESE_PRESETS['6500']).toContain(FONT_SUBSET_CHINESE_PRESETS['3500'])
    expect(FONT_SUBSET_CHINESE_PRESETS['8105']).toContain(FONT_SUBSET_CHINESE_PRESETS['6500'])
  })

  it('includes every Anime.js scramble text named character preset', () => {
    const expectedCharacters = [
      ...Array.from({ length: 95 }, (_, index) => String.fromCodePoint(0x20 + index)),
      ...Array.from({ length: 256 }, (_, index) => String.fromCodePoint(0x2800 + index)),
      ...Array.from({ length: 32 }, (_, index) => String.fromCodePoint(0x2580 + index))
    ]

    expect([...FONT_SUBSET_LATIN_BASIC]).toHaveLength(383)
    expect(new Set(FONT_SUBSET_LATIN_BASIC).size).toBe(383)
    expect(
      expectedCharacters.every((character) => FONT_SUBSET_LATIN_BASIC.includes(character))
    ).toBe(true)
    expect(FONT_SUBSET_LATIN_BASIC).toContain('░▒▓')
  })

  it('builds Latin and Chinese presets with optional extra characters', async () => {
    const latin = await resolveFontSubsetText({
      ...DEFAULT_FONT_OPTIONS,
      operation: 'subset',
      subsetMode: 'latin',
      subsetExtraText: '品A'
    })
    expect(latin).toContain(FONT_SUBSET_LATIN_BASIC)
    expect(latin).toContain('品')
    expect([...latin].filter((character) => character === 'A')).toHaveLength(1)

    const chinese = await resolveFontSubsetText({
      ...DEFAULT_FONT_OPTIONS,
      operation: 'subset',
      subsetMode: 'chinese',
      subsetChineseLevel: '6500',
      subsetExtraText: '𫚭'
    })
    expect(chinese).toContain(FONT_SUBSET_CHINESE_PRESETS['6500'])
    expect(chinese).toContain(FONT_SUBSET_CHINESE_PUNCTUATION)
    expect(chinese).toContain('𫚭')
  })

  it('builds custom text from direct input or a TXT file', async () => {
    const withoutLatin = await resolveFontSubsetText({
      ...DEFAULT_FONT_OPTIONS,
      operation: 'subset',
      subsetMode: 'custom',
      subsetIncludeLatin: false,
      subsetText: '测试测试'
    })
    expect(withoutLatin).toBe('测试')

    const textFile = join(fixtureDirectory, 'characters.txt')
    await writeFile(textFile, '文件字A')
    const fromFile = await resolveFontSubsetText({
      ...DEFAULT_FONT_OPTIONS,
      operation: 'subset',
      subsetMode: 'custom',
      subsetIncludeLatin: true,
      subsetText: '',
      subsetTextFile: textFile
    })
    expect(fromFile).toContain(FONT_SUBSET_LATIN_BASIC)
    expect(fromFile).toContain('文件字')
  })
})
