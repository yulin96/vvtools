import { existsSync } from 'fs'
import { extname, join, parse } from 'path'
import type {
  AudioFormat,
  FontFormat,
  ImageFormat,
  OutputConflictPolicy,
  PdfImageFormat,
  SpriteImageFormat,
  TaskKind,
  VideoFormat
} from '../../shared/types'

const IMAGE_EXTENSIONS: Record<Exclude<ImageFormat, 'original'>, string> = {
  jpeg: '.jpg',
  png: '.png',
  webp: '.webp',
  avif: '.avif'
}

const FONT_EXTENSIONS: Record<FontFormat, string> = {
  ttf: '.ttf',
  otf: '.otf',
  woff: '.woff',
  woff2: '.woff2'
}

export function getOutputExtension(
  kind: TaskKind,
  sourcePath: string,
  imageFormat?: ImageFormat,
  videoFormat?: VideoFormat,
  audioFormat?: AudioFormat,
  pdfImageFormat?: PdfImageFormat,
  fontFormat?: FontFormat
): string {
  if (kind === 'video') {
    if (!videoFormat) return '.mp4'
    if (videoFormat === 'source') return extname(sourcePath).toLowerCase()
    return `.${videoFormat}`
  }
  if (kind === 'audio') return `.${audioFormat ?? 'mp3'}`
  if (kind === 'pdf') {
    if (!pdfImageFormat) return '.pdf'
    return pdfImageFormat === 'jpeg' ? '.jpg' : `.${pdfImageFormat}`
  }
  if (kind === 'font') return FONT_EXTENSIONS[fontFormat ?? 'ttf']
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
  page?: number
  index?: number
  instance?: string
  date?: Date
}

export interface ResolvedOutputPath {
  path: string
  skipped: boolean
  overwritesExisting: boolean
}

interface ResolvePdfImageOutputOptions {
  sourcePath: string
  outputDirectory: string
  imageFormat: PdfImageFormat
  pageNumbers: number[]
  reservedPaths: Set<string>
  outputSuffix?: string
  nameTemplate?: string
  conflictPolicy?: OutputConflictPolicy
  presetName?: string
  width?: number
  height?: number
}

interface ResolveSpriteOutputOptions {
  sourcePath: string
  outputDirectory: string
  imageFormat: SpriteImageFormat
  sheetCount: number
  reservedPaths: Set<string>
  outputSuffix?: string
  nameTemplate?: string
  conflictPolicy?: OutputConflictPolicy
  presetName?: string
  width?: number
  height?: number
}

export interface ResolvedPdfImageOutput {
  directory: ResolvedOutputPath
  paths: string[]
}

export function resolveSpriteOutput(options: ResolveSpriteOutputOptions): ResolvedPdfImageOutput {
  const directory = resolveOutputPath({
    sourcePath: options.sourcePath,
    outputDirectory: options.outputDirectory,
    extension: '',
    reservedPaths: options.reservedPaths,
    outputSuffix: options.outputSuffix,
    nameTemplate: '{name}{suffix}',
    conflictPolicy: options.conflictPolicy
  })
  if (directory.skipped) return { directory, paths: [] }

  const extension = options.imageFormat === 'jpeg' ? '.jpg' : `.${options.imageFormat}`
  const reservedImagePaths = new Set<string>()
  const template = options.nameTemplate?.includes('{index}')
    ? options.nameTemplate
    : `${options.nameTemplate ?? '{name}{suffix}'}_{index}`
  const paths = Array.from(
    { length: options.sheetCount },
    (_, index) =>
      resolveOutputPath({
        sourcePath: options.sourcePath,
        outputDirectory: directory.path,
        extension,
        reservedPaths: reservedImagePaths,
        outputSuffix: options.outputSuffix,
        nameTemplate: template,
        conflictPolicy: 'rename',
        presetName: options.presetName,
        width: options.width,
        height: options.height,
        index: index + 1
      }).path
  )
  return { directory, paths }
}

export function resolvePdfImageOutput(
  options: ResolvePdfImageOutputOptions
): ResolvedPdfImageOutput {
  const directory = resolveOutputPath({
    sourcePath: options.sourcePath,
    outputDirectory: options.outputDirectory,
    extension: '',
    reservedPaths: options.reservedPaths,
    outputSuffix: options.outputSuffix,
    nameTemplate: '{name}{suffix}',
    conflictPolicy: options.conflictPolicy
  })
  if (directory.skipped) return { directory, paths: [] }

  const extension = options.imageFormat === 'jpeg' ? '.jpg' : `.${options.imageFormat}`
  const reservedImagePaths = new Set<string>()
  const paths = options.pageNumbers.map(
    (page) =>
      resolveOutputPath({
        sourcePath: options.sourcePath,
        outputDirectory: directory.path,
        extension,
        reservedPaths: reservedImagePaths,
        outputSuffix: options.outputSuffix,
        nameTemplate: options.nameTemplate,
        conflictPolicy: 'rename',
        presetName: options.presetName,
        width: options.width,
        height: options.height,
        page
      }).path
  )
  return { directory, paths }
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
    if (hasReservedPath(reservedPaths, candidate)) {
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

function hasReservedPath(reservedPaths: ReadonlySet<string>, candidate: string): boolean {
  if (reservedPaths.has(candidate)) return true
  if (process.platform !== 'win32') return false
  const normalizedCandidate = candidate.toLowerCase()
  return [...reservedPaths].some((path) => path.toLowerCase() === normalizedCandidate)
}

export function renderOutputBaseName(
  sourcePath: string,
  template: string,
  context: Pick<
    ResolveOutputPathOptions,
    'outputSuffix' | 'presetName' | 'width' | 'height' | 'page' | 'index' | 'instance' | 'date'
  > = {}
): string {
  const date = context.date ?? new Date()
  const values: Record<string, string> = {
    name: parse(sourcePath).name,
    suffix: context.outputSuffix ?? '',
    preset: context.presetName ?? '自定义',
    width: context.width ? String(context.width) : '未知',
    height: context.height ? String(context.height) : '未知',
    page: context.page ? String(context.page).padStart(3, '0') : '未知',
    index: context.index ? String(context.index) : '未知',
    instance: context.instance ?? '默认',
    date: [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('')
  }
  const rendered = template.replace(
    /\{(name|suffix|preset|width|height|page|index|instance|date)\}/gu,
    (_, token: string) => values[token]
  )
  const safe = rendered
    .replace(/[<>:"/\\|?*]/gu, '_')
    .replace(/./gu, (character) => (character.charCodeAt(0) < 32 ? '_' : character))
    .replace(/[. ]+$/gu, '')
    .trim()
  return safe || parse(sourcePath).name
}
