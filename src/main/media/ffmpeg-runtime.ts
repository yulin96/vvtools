import { app } from 'electron'
import { spawn } from 'child_process'
import { basename, join } from 'path'
import ffmpegStaticPath from 'ffmpeg-static'
import ffprobeStaticPath from '@derhuerst/ffprobe-static'
import type { RuntimeCapabilities, TaskCommand } from '../../shared/types'

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

async function inspectBinary(getPath: () => string): Promise<RuntimeCapabilities['ffmpeg']> {
  try {
    return { available: true, version: await readVersion(getPath()) }
  } catch (error) {
    return { available: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function getRuntimeCapabilities(): Promise<RuntimeCapabilities> {
  const [ffmpeg, ffprobe] = await Promise.all([
    inspectBinary(getFfmpegPath),
    inspectBinary(getFfprobePath)
  ])

  try {
    const sharp = await import('sharp')
    return {
      ffmpeg,
      ffprobe,
      sharp: { available: true, version: sharp.versions.sharp }
    }
  } catch (error) {
    return {
      ffmpeg,
      ffprobe,
      sharp: { available: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
}
