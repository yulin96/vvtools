import { createRequire } from 'module'
import { readFile, writeFile } from 'fs/promises'
import { statSync } from 'fs'
import { extname } from 'path'
import { instantiateVariableFont, subset } from '@web-alchemy/fonttools'
import type { FontFormat, FontInstance, FontOptions, MediaTask } from '../../shared/types'
import { MediaProcessError, TaskCancelledError } from './errors'
import { createTaskCommand } from './ffmpeg-runtime'

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
    const input = await readFile(task.sourcePath)
    onProgress(10)
    let output: Uint8Array
    if (options.operation === 'variableStatic') {
      const axes = task.fontInstance?.axes ?? {}
      const staticAxes = Object.fromEntries(
        Object.entries(axes).map(([tag, value]) => [tag, [value, value]])
      )
      const instantiated = await instantiateVariableFont(input, staticAxes)
      if (signal.aborted) throw new TaskCancelledError()
      output = await convertFont(instantiated, options.outputFormat, signal)
    } else {
      output = await subsetFont(input, options, task.fontIndex, signal)
    }
    if (signal.aborted) throw new TaskCancelledError()
    if (!output.byteLength) throw new Error('字体处理器没有生成有效输出')
    await writeFile(task.outputPath, Buffer.from(output))
    onProgress(100)
    return statSync(task.outputPath).size
  } catch (error) {
    if (error instanceof TaskCancelledError || error instanceof MediaProcessError) throw error
    throw new MediaProcessError('字体处理失败，请确认字体文件未损坏或参数有效', {
      command,
      stderrTail: error instanceof Error ? error.message : String(error)
    })
  }
}

async function subsetFont(
  input: Uint8Array,
  options: FontOptions,
  fontIndex: number | undefined,
  signal: AbortSignal
): Promise<Uint8Array> {
  if (signal.aborted) throw new TaskCancelledError()
  const subsetOptions: Record<string, unknown> = {
    'layout-features': '*',
    flavor: fontFlavor(options.outputFormat)
  }
  if (options.operation === 'subset') {
    if (options.subsetTextFile) {
      subsetOptions.text = await readFile(options.subsetTextFile, 'utf8')
    } else if (options.subsetText) {
      subsetOptions.text = options.subsetText
    }
  } else {
    subsetOptions['*'] = true
  }
  if (signal.aborted) throw new TaskCancelledError()
  if (fontIndex !== undefined) subsetOptions['font-number'] = fontIndex
  if (!subsetOptions.flavor) delete subsetOptions.flavor
  return subset(input, subsetOptions)
}

async function convertFont(
  input: Uint8Array,
  outputFormat: FontFormat,
  signal: AbortSignal
): Promise<Uint8Array> {
  if (signal.aborted) throw new TaskCancelledError()
  const options: Record<string, unknown> = {
    '*': true,
    'layout-features': '*',
    flavor: fontFlavor(outputFormat)
  }
  if (!options.flavor) delete options.flavor
  return subset(input, options)
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
