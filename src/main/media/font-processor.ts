import { createRequire } from 'module'
import { readFile } from 'fs/promises'
import { extname } from 'path'
import type { FontFormat, FontInstance, FontOptions, MediaTask } from '../../shared/types'
import {
  FONT_SUBSET_CHINESE_PRESETS,
  FONT_SUBSET_CHINESE_PUNCTUATION,
  FONT_SUBSET_LATIN_BASIC,
  uniqueCharacters
} from '../../shared/font-subset-presets'
import { MediaProcessError, TaskCancelledError } from './errors'
import { createTaskCommand } from './ffmpeg-runtime'
import { runFontProcess } from './font-process'

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

export async function probeFont(
  sourcePath: string,
  options: FontOptions,
  signal: AbortSignal
): Promise<FontProbe> {
  if (signal.aborted) throw new TaskCancelledError()
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

export async function processFont(
  task: MediaTask,
  signal: AbortSignal,
  onProgress: (progress: number) => void = () => undefined
): Promise<number> {
  if (signal.aborted) throw new TaskCancelledError()
  const options = task.options as FontOptions
  const command = createTaskCommand('fonttools', [
    options.operation,
    task.sourcePath,
    `--output-format=${options.outputFormat}`,
    ...(task.fontIndex !== undefined ? [`--font-number=${task.fontIndex}`] : []),
    ...(task.fontInstance ? [`--instance=${task.fontInstance.name}`] : []),
    task.outputPath
  ])

  try {
    onProgress(10)
    let outputSize: number
    if (options.operation === 'variableStatic') {
      const axes = task.fontInstance?.axes ?? {}
      const staticAxes = Object.fromEntries(
        Object.entries(axes).map(([tag, value]) => [tag, [value, value] as [number, number]])
      )
      outputSize = await runFontProcess(
        {
          sourcePath: task.sourcePath,
          outputPath: task.outputPath,
          staticAxes,
          subsetOptions: createConvertOptions(options.outputFormat)
        },
        signal
      )
    } else {
      outputSize = await processSubsetFont(task, options, signal)
    }
    if (signal.aborted) throw new TaskCancelledError()
    onProgress(100)
    return outputSize
  } catch (error) {
    if (error instanceof TaskCancelledError || error instanceof MediaProcessError) throw error
    throw new MediaProcessError('字体处理失败，请确认字体文件未损坏或参数有效', {
      command,
      stderrTail: error instanceof Error ? error.message : String(error)
    })
  }
}

async function processSubsetFont(
  task: MediaTask,
  options: FontOptions,
  signal: AbortSignal
): Promise<number> {
  if (signal.aborted) throw new TaskCancelledError()
  const subsetOptions: Record<string, unknown> = {
    'layout-features': '*',
    'drop-tables+': 'meta',
    flavor: fontFlavor(options.outputFormat)
  }
  if (options.operation === 'subset') {
    subsetOptions.text = await resolveFontSubsetText(options)
  } else {
    subsetOptions['*'] = true
  }
  if (signal.aborted) throw new TaskCancelledError()
  if (task.fontIndex !== undefined) subsetOptions['font-number'] = task.fontIndex
  if (!subsetOptions.flavor) delete subsetOptions.flavor
  return runFontProcess(
    {
      sourcePath: task.sourcePath,
      outputPath: task.outputPath,
      subsetOptions
    },
    signal
  )
}

export async function resolveFontSubsetText(options: FontOptions): Promise<string> {
  if (options.subsetMode === 'latin') {
    return uniqueCharacters(FONT_SUBSET_LATIN_BASIC, options.subsetExtraText)
  }
  if (options.subsetMode === 'chinese') {
    return uniqueCharacters(
      FONT_SUBSET_LATIN_BASIC,
      FONT_SUBSET_CHINESE_PUNCTUATION,
      FONT_SUBSET_CHINESE_PRESETS[options.subsetChineseLevel],
      options.subsetExtraText
    )
  }

  const customText = options.subsetTextFile
    ? await readFile(options.subsetTextFile, 'utf8')
    : options.subsetText
  return uniqueCharacters(options.subsetIncludeLatin ? FONT_SUBSET_LATIN_BASIC : '', customText)
}

function createConvertOptions(outputFormat: FontFormat): Record<string, unknown> {
  const options: Record<string, unknown> = {
    '*': true,
    'layout-features': '*',
    'drop-tables+': 'meta',
    flavor: fontFlavor(outputFormat)
  }
  if (!options.flavor) delete options.flavor
  return options
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

function fontFlavor(format: FontFormat): 'woff' | 'woff2' | undefined {
  return format === 'woff' || format === 'woff2' ? format : undefined
}

function fontFormatFromPath(sourcePath: string): string {
  const extension = extname(sourcePath).toLowerCase()
  return extension ? extension.slice(1).toUpperCase() : '字体'
}
