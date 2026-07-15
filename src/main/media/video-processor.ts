import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { rmSync, statSync } from 'fs'
import type { MediaTask, VideoOptions } from '../../shared/types'
import { FailureLogService } from '../services/failure-log'
import { MediaProcessError, TaskCancelledError } from './errors'
import { createTaskCommand, getFfmpegPath, getFfprobePath } from './ffmpeg-runtime'

const CRF_BY_QUALITY: Record<VideoOptions['quality'], string> = {
  high: '20',
  balanced: '23',
  small: '28'
}

export function buildVideoArgs(task: MediaTask): string[] {
  const options = task.options as VideoOptions
  const args = ['-hide_banner', '-nostdin', '-n', '-i', task.sourcePath]

  if (options.resolution !== 'source') {
    const bounds = options.resolution === '1080p' ? [1920, 1080] : [1280, 720]
    args.push(
      '-vf',
      `scale=w='min(${bounds[0]}\\,iw)':h='min(${bounds[1]}\\,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`
    )
  }

  args.push(
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    '-c:v',
    options.codec === 'h265' ? 'libx265' : 'libx264'
  )

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
    args.push('-crf', CRF_BY_QUALITY[options.quality])
  }

  args.push('-preset', 'medium', '-pix_fmt', 'yuv420p')

  if (options.frameRate !== 'source') args.push('-r', options.frameRate)

  if (options.audioMode === 'none') {
    args.push('-an')
  } else if (options.audioMode === 'copy') {
    args.push('-c:a', 'copy')
  } else {
    args.push('-c:a', 'aac', '-b:a', `${options.audioBitrateKbps}k`)
  }

  if (options.format === 'mp4' || options.format === 'mov') args.push('-movflags', '+faststart')

  args.push('-progress', 'pipe:1', '-nostats', task.outputPath)
  return args
}

function runProbe(sourcePath: string, signal: AbortSignal): Promise<number> {
  const executable = getFfprobePath()
  const args = ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', sourcePath]
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
        const duration = Number(
          (JSON.parse(stdout) as { format?: { duration?: string } }).format?.duration
        )
        if (!Number.isFinite(duration) || duration <= 0) throw new Error('无有效时长')
        resolve(duration)
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
  const duration = await runProbe(task.sourcePath, signal)
  if (signal.aborted) throw new TaskCancelledError()

  const executable = getFfmpegPath()
  const args = buildVideoArgs(task)
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
          const progress = (Number(value) / (duration * 1_000_000)) * 100
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
