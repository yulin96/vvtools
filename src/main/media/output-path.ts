import { existsSync } from 'fs'
import { extname, join, parse, resolve } from 'path'
import type {
  AudioFormat,
  ImageFormat,
  OutputConflictPolicy,
  TaskKind,
  VideoFormat
} from '../../shared/types'

const IMAGE_EXTENSIONS: Record<Exclude<ImageFormat, 'original'>, string> = {
  jpeg: '.jpg',
  png: '.png',
  webp: '.webp',
  avif: '.avif'
}

export function getOutputExtension(
  kind: TaskKind,
  sourcePath: string,
  imageFormat?: ImageFormat,
  videoFormat?: VideoFormat,
  audioFormat?: AudioFormat
): string {
  if (kind === 'video') {
    if (!videoFormat) return '.mp4'
    if (videoFormat === 'source') return extname(sourcePath).toLowerCase()
    return `.${videoFormat}`
  }
  if (kind === 'audio') return `.${audioFormat ?? 'mp3'}`
  if (imageFormat && imageFormat !== 'original') return IMAGE_EXTENSIONS[imageFormat]
  const extension = extname(sourcePath).toLowerCase()
  return extension === '.jpeg' ? '.jpg' : extension
}

export function createAvailableOutputPath(
  sourcePath: string,
  outputDirectory: string,
  extension: string,
  reservedPaths: Set<string>,
  outputSuffix = ''
): string {
  return resolveOutputPath({
    sourcePath,
    outputDirectory,
    extension,
    reservedPaths,
    outputSuffix
  }).path
}

interface ResolveOutputPathOptions {
  sourcePath: string
  outputDirectory: string
  extension: string
  reservedPaths: Set<string>
  outputSuffix?: string
  nameTemplate?: string
  conflictPolicy?: OutputConflictPolicy
  presetName?: string
  width?: number
  height?: number
  date?: Date
}

export interface ResolvedOutputPath {
  path: string
  skipped: boolean
  overwritesExisting: boolean
}

export function resolveOutputPath(options: ResolveOutputPathOptions): ResolvedOutputPath {
  const {
    sourcePath,
    outputDirectory,
    extension,
    reservedPaths,
    nameTemplate = '{name}{suffix}',
    conflictPolicy = 'rename'
  } = options
  const baseName = renderOutputBaseName(sourcePath, nameTemplate, options)
  let index = 0

  while (true) {
    const numberedSuffix = index === 0 ? '' : `_${index}`
    const candidate = join(outputDirectory, `${baseName}${numberedSuffix}${extension}`)
    if (reservedPaths.has(candidate)) {
      if (conflictPolicy === 'skip') {
        return { path: candidate, skipped: true, overwritesExisting: false }
      }
      index += 1
      continue
    }
    if (!existsSync(candidate)) {
      reservedPaths.add(candidate)
      return { path: candidate, skipped: false, overwritesExisting: false }
    }
    if (conflictPolicy === 'skip') {
      return { path: candidate, skipped: true, overwritesExisting: false }
    }
    if (conflictPolicy === 'overwrite') {
      reservedPaths.add(candidate)
      return { path: candidate, skipped: false, overwritesExisting: true }
    }
    index += 1
  }
}

export function pathsReferToSameFile(left: string, right: string): boolean {
  const leftPath = resolve(left)
  const rightPath = resolve(right)
  return process.platform === 'win32'
    ? leftPath.toLowerCase() === rightPath.toLowerCase()
    : leftPath === rightPath
}

export function renderOutputBaseName(
  sourcePath: string,
  template: string,
  context: Pick<
    ResolveOutputPathOptions,
    'outputSuffix' | 'presetName' | 'width' | 'height' | 'date'
  > = {}
): string {
  const date = context.date ?? new Date()
  const values: Record<string, string> = {
    name: parse(sourcePath).name,
    suffix: context.outputSuffix ?? '',
    preset: context.presetName ?? '自定义',
    width: context.width ? String(context.width) : '未知',
    height: context.height ? String(context.height) : '未知',
    date: [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('')
  }
  const rendered = template.replace(
    /\{(name|suffix|preset|width|height|date)\}/gu,
    (_, token: string) => values[token]
  )
  const safe = rendered
    .replace(/[<>:"/\\|?*]/gu, '_')
    .replace(/./gu, (character) => (character.charCodeAt(0) < 32 ? '_' : character))
    .replace(/[. ]+$/gu, '')
    .trim()
  return safe || parse(sourcePath).name
}
