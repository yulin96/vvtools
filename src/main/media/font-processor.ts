import { readFile } from 'fs/promises'
import type { FontFormat, FontOptions, MediaTask } from '../../shared/types'
import {
  FONT_SUBSET_CHINESE_PRESETS,
  FONT_SUBSET_CHINESE_PUNCTUATION,
  FONT_SUBSET_LATIN_BASIC,
  uniqueCharacters
} from '../../shared/font-subset-presets'
import { MediaProcessError, TaskCancelledError } from './errors'
import { createTaskCommand, getFonttoolsDirectory } from './ffmpeg-runtime'
import { runFontProcess } from './font-process'

import type { FontProbe } from './font-probe-core'
import { fontMetadataProcesses } from './font-metadata-process'

export type { FontProbe } from './font-probe-core'
export async function probeFont(
  sourcePath: string,
  options: FontOptions,
  signal: AbortSignal
): Promise<FontProbe> {
  return fontMetadataProcesses.run<FontProbe>({ kind: 'probe', sourcePath, options }, signal)
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
        signal,
        getFonttoolsDirectory()
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
    signal,
    getFonttoolsDirectory()
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

function fontFlavor(format: FontFormat): 'woff' | 'woff2' | undefined {
  return format === 'woff' || format === 'woff2' ? format : undefined
}
