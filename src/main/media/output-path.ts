import { isReplaceableOutputDirectory } from './output-directory'
import { pathKey as platformPathKey } from '../../shared/path-key'
import { lstatSync } from 'fs'
import { extname, join, parse, resolve, sep } from 'path'
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

interface ResolveOutputPathOptions {
  sourcePath: string
  outputDirectory: string
  extension: string
  reservedPaths: Set<string>
  protectedSourcePaths?: ReadonlySet<string>
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
  protectedSourcePaths?: ReadonlySet<string>
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
  protectedSourcePaths?: ReadonlySet<string>
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
    protectedSourcePaths: options.protectedSourcePaths,
    outputSuffix: options.outputSuffix,
    nameTemplate: '{name}{suffix}',
    conflictPolicy: options.conflictPolicy
  })
  if (directory.skipped) return { directory, paths: [] }

  const extension = options.imageFormat === 'jpeg' ? '.jpg' : `.${options.imageFormat}`
  const template = options.nameTemplate?.includes('{index}')
    ? options.nameTemplate
    : `${options.nameTemplate ?? '{name}{suffix}'}_{index}`
  const names = Array.from({ length: options.sheetCount }, (_, index) =>
    renderOutputBaseName(options.sourcePath, template, { ...options, index: index + 1 })
  )
  const paths = groupOutputPaths(directory.path, names, extension)
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
    protectedSourcePaths: options.protectedSourcePaths,
    outputSuffix: options.outputSuffix,
    nameTemplate: '{name}{suffix}',
    conflictPolicy: options.conflictPolicy
  })
  if (directory.skipped) return { directory, paths: [] }

  const extension = options.imageFormat === 'jpeg' ? '.jpg' : `.${options.imageFormat}`
  const names = options.pageNumbers.map((page) =>
    renderOutputBaseName(options.sourcePath, options.nameTemplate ?? '{name}{suffix}', {
      ...options,
      page
    })
  )
  const paths = groupOutputPaths(directory.path, names, extension)
  return { directory, paths }
}

// Group outputs are assembled in an empty staging directory, then committed together.
function groupOutputPaths(directory: string, names: string[], extension: string): string[] {
  const used = new Set<string>()
  const nextSuffix = new Map<string, number>()
  return names.map((name) => {
    const base = pathKey(join(directory, name + extension))
    let index = nextSuffix.get(base) ?? 0
    let path: string
    let key: string
    do {
      path = join(directory, name + (index ? '_' + index : '') + extension)
      key = pathKey(path)
      index++
    } while (used.has(key))
    nextSuffix.set(base, index)
    used.add(key)
    return path
  })
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
    if (
      pathKey(sourcePath).startsWith(pathKey(candidate) + sep) ||
      hasReservedPath(reservedPaths, candidate) ||
      [...(options.protectedSourcePaths ?? [])].some((path) =>
        outputContainsSourcePath(candidate, path)
      )
    ) {
      if (conflictPolicy === 'skip') {
        return { path: candidate, skipped: true, overwritesExisting: false }
      }
      index += 1
      continue
    }
    const entry = lstatSync(candidate, { throwIfNoEntry: false })
    if (!entry) {
      reservedPaths.add(candidate)
      return { path: candidate, skipped: false, overwritesExisting: false }
    }
    if (conflictPolicy === 'skip') {
      return { path: candidate, skipped: true, overwritesExisting: false }
    }
    if (
      conflictPolicy === 'overwrite' &&
      (extension === '' ? isReplaceableOutputDirectory(candidate) : !entry.isDirectory())
    ) {
      reservedPaths.add(candidate)
      return { path: candidate, skipped: false, overwritesExisting: true }
    }
    index += 1
  }
}

function hasReservedPath(reservedPaths: ReadonlySet<string>, candidate: string): boolean {
  if (reservedPaths.has(candidate)) return true
  const normalizedCandidate = pathKey(candidate)
  return [...reservedPaths].some((path) => pathKey(path) === normalizedCandidate)
}

function pathKey(path: string): string {
  return platformPathKey(resolve(path), process.platform)
}

export function outputContainsSourcePath(outputPath: string, sourcePath: string): boolean {
  const output = pathKey(outputPath)
  const source = pathKey(sourcePath)
  return source === output || source.startsWith(`${output}${sep}`)
}

export function getProtectedSourcePaths(
  sourcePaths: string[],
  sourceIndex: number,
  activeSourcePaths: ReadonlySet<string>
): Set<string> {
  return new Set([...activeSourcePaths, ...sourcePaths.filter((_, index) => index !== sourceIndex)])
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
    .replace(/./gsu, (character) => (character.charCodeAt(0) < 32 ? '_' : character))
    .replace(/[. ]+$/gu, '')
    .trim()
  return safe || '未命名'
}
