import { app } from 'electron'
import { spawn } from 'child_process'
import { basename, join } from 'path'
import ffmpegStaticPath from 'ffmpeg-static'
import ffprobeStaticPath from '@derhuerst/ffprobe-static'
import type { RuntimeCapabilities, TaskCommand } from '../../shared/types'

let hardwareEncodersPromise: Promise<string[]> | null = null

function packagedBinaryPath(name: 'ffmpeg' | 'ffprobe'): string {
  return join(process.resourcesPath, 'bin', process.platform === 'win32' ? `${name}.exe` : name)
}

export function getFfmpegPath(): string {
  const path = app.isPackaged ? packagedBinaryPath('ffmpeg') : ffmpegStaticPath
  if (!path) throw new Error(`当前平台 ${process.platform}-${process.arch} 没有可用的 FFmpeg`)
  return path
}

export function getFfprobePath(): string {
  const path = app.isPackaged ? packagedBinaryPath('ffprobe') : ffprobeStaticPath
  if (!path) throw new Error(`当前平台 ${process.platform}-${process.arch} 没有可用的 FFprobe`)
  return path
}

function quote(value: string): string {
  if (!/[\s"']/u.test(value)) return value
  return `"${value.replaceAll('"', '\\"')}"`
}

export function createTaskCommand(executable: string, args: string[]): TaskCommand {
  return {
    executable,
    args: [...args],
    display: [quote(basename(executable)), ...args.map(quote)].join(' ')
  }
}

function readVersion(executable: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-version'], { windowsHide: true })
    let output = ''
    let errorOutput = ''
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (errorOutput += chunk.toString()))
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolve(output.split(/\r?\n/u)[0] || '可用')
      else reject(new Error(errorOutput.trim() || `退出码 ${code}`))
    })
  })
}

function readProcess(
  executable: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(stderr.trim() || `退出码 ${code}`))
    })
  })
}

export function hardwareEncoderCandidates(
  codec: 'h264' | 'h265',
  platform: NodeJS.Platform = process.platform
): string[] {
  if (platform === 'darwin') {
    return [codec === 'h264' ? 'h264_videotoolbox' : 'hevc_videotoolbox']
  }
  if (platform === 'win32' || platform === 'linux') {
    return codec === 'h264' ? ['h264_nvenc', 'h264_qsv'] : ['hevc_nvenc', 'hevc_qsv']
  }
  return []
}

export async function getAvailableHardwareVideoEncoders(): Promise<string[]> {
  hardwareEncodersPromise ??= detectHardwareVideoEncoders()
  return hardwareEncodersPromise
}

export function refreshHardwareVideoEncoders(): Promise<string[]> {
  hardwareEncodersPromise = detectHardwareVideoEncoders()
  return hardwareEncodersPromise
}

export async function resolveHardwareVideoEncoder(codec: 'h264' | 'h265'): Promise<string | null> {
  const available = await getAvailableHardwareVideoEncoders()
  return hardwareEncoderCandidates(codec).find((encoder) => available.includes(encoder)) ?? null
}

async function detectHardwareVideoEncoders(): Promise<string[]> {
  const executable = getFfmpegPath()
  const { stdout, stderr } = await readProcess(executable, ['-hide_banner', '-encoders'])
  const encoderList = `${stdout}\n${stderr}`
  const candidates = [
    ...hardwareEncoderCandidates('h264'),
    ...hardwareEncoderCandidates('h265')
  ].filter((encoder, index, values) => values.indexOf(encoder) === index)
  const available: string[] = []
  for (const encoder of candidates) {
    if (!new RegExp(`\\b${encoder}\\b`, 'u').test(encoderList)) continue
    if (await canStartHardwareEncoder(executable, encoder)) available.push(encoder)
  }
  return available
}

async function canStartHardwareEncoder(executable: string, encoder: string): Promise<boolean> {
  try {
    await readProcess(executable, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=size=64x64:rate=1',
      '-frames:v',
      '1',
      '-an',
      '-c:v',
      encoder,
      '-f',
      'null',
      '-'
    ])
    return true
  } catch {
    return false
  }
}

async function inspectBinary(getPath: () => string): Promise<RuntimeCapabilities['ffmpeg']> {
  try {
    return { available: true, version: await readVersion(getPath()) }
  } catch (error) {
    return { available: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function inspectSharpRuntime(): Promise<RuntimeCapabilities['sharp']> {
  try {
    const { default: sharp } = await import('sharp')
    return { available: true, version: sharp.versions.sharp }
  } catch (error) {
    return { available: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function getRuntimeCapabilities(): Promise<RuntimeCapabilities> {
  const [ffmpeg, ffprobe, hardwareResult, sharp] = await Promise.all([
    inspectBinary(getFfmpegPath),
    inspectBinary(getFfprobePath),
    refreshHardwareVideoEncoders()
      .then((encoders) => ({ encoders }))
      .catch((error) => ({
        encoders: [],
        error: error instanceof Error ? error.message : String(error)
      })),
    inspectSharpRuntime()
  ])
  const hardwareVideo = {
    available: hardwareResult.encoders.length > 0,
    encoders: hardwareResult.encoders,
    version: hardwareResult.encoders.length > 0 ? hardwareResult.encoders.join('、') : undefined,
    error:
      'error' in hardwareResult
        ? hardwareResult.error
        : hardwareResult.encoders.length === 0
          ? '未检测到可用的硬件编码器'
          : undefined
  }

  return {
    ffmpeg,
    ffprobe,
    sharp,
    hardwareVideo
  }
}
