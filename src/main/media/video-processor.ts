import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { rmSync, statSync } from 'fs'
import { extname } from 'path'
import type { MediaTask, VideoOptions } from '../../shared/types'
import { FailureLogService } from '../services/failure-log'
import { MediaProcessError, TaskCancelledError } from './errors'
import {
  createTaskCommand,
  getFfmpegPath,
  getFfprobePath,
  resolveHardwareVideoEncoder
} from './ffmpeg-runtime'

const CRF_BY_QUALITY: Record<VideoOptions['quality'], string> = {
  high: '20',
  balanced: '23',
  small: '28'
}

export function buildVideoArgs(
  task: MediaTask,
  sourceVideoCodec?: string,
  hardwareEncoder?: string
): string[] {
  const options = task.options as VideoOptions
  const args = ['-hide_banner', '-nostdin', '-n', '-i', task.sourcePath]
  const copyVideo =
    options.codec === 'source' && options.resolution === 'source' && options.frameRate === 'source'

  const resolutionBounds = getVideoResolutionBounds(options)
  if (!copyVideo && resolutionBounds) {
    args.push(
      '-vf',
      `scale=w='min(${resolutionBounds[0]}\\,iw)':h='min(${resolutionBounds[1]}\\,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`
    )
  }

  args.push('-map', '0:v:0', '-map', '0:a?')

  if (copyVideo) {
    args.push('-c:v', 'copy')
  } else {
    const encoder = hardwareEncoder ?? resolveSoftwareVideoEncoder(options.codec, sourceVideoCodec)
    args.push('-c:v', encoder)

    if (options.rateControl === 'bitrate') {
      args.push(
        '-b:v',
        `${options.bitrateMbps}M`,
        '-maxrate',
        `${options.bitrateMbps}M`,
        '-bufsize',
        `${options.bitrateMbps * 2}M`
      )
    } else {
      addQualityArgs(args, encoder, options.quality)
    }

    addEncoderPerformanceArgs(args, encoder)
    args.push('-pix_fmt', 'yuv420p')

    if (options.frameRate !== 'source') {
      args.push(
        '-r',
        String(options.frameRate === 'custom' ? options.customFrameRate : options.frameRate)
      )
    }
  }

  if (options.audioMode === 'none') {
    args.push('-an')
  } else if (options.audioMode === 'copy') {
    args.push('-c:a', 'copy')
  } else {
    args.push('-c:a', 'aac', '-b:a', `${options.audioBitrateKbps}k`)
  }

  const outputExtension =
    options.format === 'source' ? extname(task.outputPath).toLowerCase() : `.${options.format}`
  if (['.mp4', '.mov'].includes(outputExtension)) {
    args.push('-movflags', '+faststart')
  }

  args.push('-progress', 'pipe:1', '-nostats', task.outputPath)
  return args
}

export function getVideoResolutionBounds(options: VideoOptions): [number, number] | undefined {
  if (options.resolution === 'source') return undefined
  const height =
    options.resolution === 'custom'
      ? options.customResolutionHeight
      : options.resolution === '1080p'
        ? 1080
        : 720
  return [Math.round((height * 16) / 9), height]
}

function resolveSoftwareVideoEncoder(
  codec: VideoOptions['codec'],
  sourceVideoCodec?: string
): string {
  if (codec === 'h264') return 'libx264'
  if (codec === 'h265') return 'libx265'
  if (codec === 'mpeg4') return 'mpeg4'
  if (sourceVideoCodec === 'h264') return 'libx264'
  if (sourceVideoCodec === 'hevc' || sourceVideoCodec === 'h265') return 'libx265'
  if (sourceVideoCodec === 'mpeg4') return 'mpeg4'
  throw new Error(
    `源视频编码 ${sourceVideoCodec || '未知'} 暂不支持保持编码后重新处理，请选择 H.264、H.265 或 MPEG-4`
  )
}

function addQualityArgs(args: string[], encoder: string, quality: VideoOptions['quality']): void {
  if (encoder.endsWith('_videotoolbox')) {
    const qualityValue = { high: '75', balanced: '60', small: '40' }[quality]
    args.push('-q:v', qualityValue)
  } else if (encoder.endsWith('_nvenc')) {
    args.push('-cq', CRF_BY_QUALITY[quality], '-b:v', '0')
  } else if (encoder.endsWith('_qsv')) {
    args.push('-global_quality', CRF_BY_QUALITY[quality])
  } else if (encoder === 'mpeg4') {
    const qualityValue = { high: '2', balanced: '5', small: '10' }[quality]
    args.push('-q:v', qualityValue)
  } else {
    args.push('-crf', CRF_BY_QUALITY[quality])
  }
}

function addEncoderPerformanceArgs(args: string[], encoder: string): void {
  if (encoder.endsWith('_videotoolbox')) args.push('-realtime', 'true')
  else if (encoder.endsWith('_nvenc')) args.push('-preset', 'p4')
  else if (encoder === 'mpeg4') return
  else args.push('-preset', 'medium')
}

function videoCodecFamily(
  codec: VideoOptions['codec'],
  sourceVideoCodec?: string
): 'h264' | 'h265' | null {
  if (codec === 'h264') return 'h264'
  if (codec === 'h265') return 'h265'
  if (codec === 'mpeg4') return null
  if (sourceVideoCodec === 'h264') return 'h264'
  if (sourceVideoCodec === 'hevc' || sourceVideoCodec === 'h265') return 'h265'
  if (sourceVideoCodec === 'mpeg4') return null
  throw new Error(
    `源视频编码 ${sourceVideoCodec || '未知'} 暂不支持保持编码后重新处理，请选择 H.264、H.265 或 MPEG-4`
  )
}

export interface VideoProbe {
  duration: number
  videoCodec: string
  width?: number
  height?: number
  format?: string
}

export function probeVideo(sourcePath: string, signal: AbortSignal): Promise<VideoProbe> {
  const executable = getFfprobePath()
  const args = [
    '-v',
    'error',
    '-show_entries',
    'format=duration,format_name:stream=codec_type,codec_name,width,height',
    '-of',
    'json',
    sourcePath
  ]
  const command = createTaskCommand(executable, args)

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    const cancel = (): void => {
      child.kill()
    }
    signal.addEventListener('abort', cancel, { once: true })
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.once('error', (error) => reject(new MediaProcessError(error.message, { command })))
    child.once('close', (code) => {
      signal.removeEventListener('abort', cancel)
      if (signal.aborted) return reject(new TaskCancelledError())
      if (code !== 0) {
        return reject(
          new MediaProcessError('无法读取视频信息，请确认文件未损坏', {
            exitCode: code ?? undefined,
            command,
            stderrTail: stderr.trim()
          })
        )
      }
      try {
        const result = JSON.parse(stdout) as {
          format?: { duration?: string; format_name?: string }
          streams?: Array<{
            codec_type?: string
            codec_name?: string
            width?: number
            height?: number
          }>
        }
        const duration = Number(result.format?.duration)
        const videoStream = result.streams?.find((stream) => stream.codec_type === 'video')
        const videoCodec = videoStream?.codec_name
        if (!Number.isFinite(duration) || duration <= 0) throw new Error('无有效时长')
        if (!videoCodec) throw new Error('无有效视频编码')
        resolve({
          duration,
          videoCodec,
          width: videoStream?.width,
          height: videoStream?.height,
          format: result.format?.format_name?.split(',')[0]
        })
      } catch {
        reject(
          new MediaProcessError('FFprobe 未返回有效的视频时长', { command, stderrTail: stderr })
        )
      }
    })
  })
}

export async function processVideo(
  task: MediaTask,
  signal: AbortSignal,
  onProgress: (progress: number) => void,
  failureLogs: FailureLogService
): Promise<number> {
  const probe = await probeVideo(task.sourcePath, signal)
  if (signal.aborted) throw new TaskCancelledError()

  const options = task.options as VideoOptions
  const copiesVideo =
    options.codec === 'source' && options.resolution === 'source' && options.frameRate === 'source'
  let hardwareEncoder: string | undefined
  if (!copiesVideo && options.encoderMode !== 'software') {
    const codec = videoCodecFamily(options.codec, probe.videoCodec)
    hardwareEncoder = codec ? ((await resolveHardwareVideoEncoder(codec)) ?? undefined) : undefined
    if (options.encoderMode === 'hardware' && !codec) {
      throw new MediaProcessError('MPEG-4 仅支持 CPU 编码，请选择自动或 CPU 编码')
    }
    if (codec && !hardwareEncoder && options.encoderMode === 'hardware') {
      throw new MediaProcessError(
        `当前设备或 FFmpeg 不支持 ${codec === 'h264' ? 'H.264' : 'H.265'} 硬件编码，请选择自动或 CPU 编码`
      )
    }
  }

  const executable = getFfmpegPath()
  const args = buildVideoArgs(task, probe.videoCodec, hardwareEncoder)
  const command = createTaskCommand(executable, args)
  const log = failureLogs.create(task, command)

  await new Promise<void>((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(executable, args, { windowsHide: true })
    } catch (error) {
      log.stream.end()
      reject(
        new MediaProcessError(error instanceof Error ? error.message : String(error), {
          command,
          logPath: log.path
        })
      )
      return
    }

    let progressBuffer = ''
    const cancel = (): void => {
      child.kill()
    }
    signal.addEventListener('abort', cancel, { once: true })
    child.stdout.on('data', (chunk: Buffer) => {
      progressBuffer += chunk.toString()
      const lines = progressBuffer.split(/\r?\n/u)
      progressBuffer = lines.pop() || ''
      for (const line of lines) {
        const [key, value] = line.split('=', 2)
        if (key === 'out_time_us') {
          const progress = (Number(value) / (probe.duration * 1_000_000)) * 100
          if (Number.isFinite(progress)) onProgress(Math.min(99, Math.max(0, progress)))
        }
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      log.stream.write(text)
      log.appendTail(text)
    })
    child.once('error', (error) => {
      signal.removeEventListener('abort', cancel)
      log.stream.end()
      reject(
        new MediaProcessError(error.message, {
          command,
          stderrTail: log.getTail(),
          logPath: log.path
        })
      )
    })
    child.once('close', (code) => {
      signal.removeEventListener('abort', cancel)
      if (signal.aborted) {
        log.discard()
        rmSync(task.outputPath, { force: true })
        return reject(new TaskCancelledError())
      }
      if (code !== 0) {
        log.stream.end()
        rmSync(task.outputPath, { force: true })
        return reject(
          new MediaProcessError('视频处理失败', {
            exitCode: code ?? undefined,
            command,
            stderrTail: log.getTail(),
            logPath: log.path
          })
        )
      }
      log.discard()
      resolve()
    })
  })

  onProgress(100)
  return statSync(task.outputPath).size
}
