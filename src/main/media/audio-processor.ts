import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { rmSync, statSync } from 'fs'
import type { AudioOptions, MediaTask } from '../../shared/types'
import { FailureLogService } from '../services/failure-log'
import { MediaProcessError, TaskCancelledError } from './errors'
import { createTaskCommand, getFfmpegPath, getFfprobePath } from './ffmpeg-runtime'

export interface AudioProbe {
  duration: number
  audioCodec: string
  format?: string
  channels?: number
  sampleRate?: number
}

export function buildAudioArgs(task: MediaTask): string[] {
  const options = task.options as AudioOptions
  const args = ['-hide_banner', '-nostdin', '-n', '-i', task.sourcePath, '-map', '0:a:0', '-vn']
  if (options.normalizeLoudness) {
    args.push('-af', 'loudnorm=I=-16:LRA=11:TP=-1.5')
  }
  if (options.channels === 'mono') args.push('-ac', '1')
  else if (options.channels === 'stereo') args.push('-ac', '2')

  if (options.format === 'mp3') {
    args.push('-c:a', 'libmp3lame', '-b:a', `${options.bitrateKbps}k`)
  } else if (options.format === 'm4a') {
    args.push('-c:a', 'aac', '-b:a', `${options.bitrateKbps}k`, '-movflags', '+faststart')
  } else if (options.format === 'wav') {
    args.push('-c:a', 'pcm_s16le')
  } else {
    args.push('-c:a', 'flac')
  }
  args.push('-progress', 'pipe:1', '-nostats', task.outputPath)
  return args
}

export function probeAudio(sourcePath: string, signal: AbortSignal): Promise<AudioProbe> {
  const executable = getFfprobePath()
  const args = [
    '-v',
    'error',
    '-show_entries',
    'format=duration,format_name:stream=codec_type,codec_name,channels,sample_rate',
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
          new MediaProcessError('无法读取音频信息，请确认文件未损坏', {
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
            channels?: number
            sample_rate?: string
          }>
        }
        const duration = Number(result.format?.duration)
        const audioStream = result.streams?.find((stream) => stream.codec_type === 'audio')
        if (!Number.isFinite(duration) || duration <= 0 || !audioStream?.codec_name) {
          throw new Error('无有效音轨')
        }
        resolve({
          duration,
          audioCodec: audioStream.codec_name,
          format: result.format?.format_name?.split(',')[0],
          channels: audioStream.channels,
          sampleRate: Number(audioStream.sample_rate) || undefined
        })
      } catch {
        reject(
          new MediaProcessError('文件中没有可处理的音轨', {
            command,
            stderrTail: stderr.trim()
          })
        )
      }
    })
  })
}

export async function processAudio(
  task: MediaTask,
  signal: AbortSignal,
  onProgress: (progress: number) => void,
  failureLogs: FailureLogService
): Promise<number> {
  const probe = await probeAudio(task.sourcePath, signal)
  if (signal.aborted) throw new TaskCancelledError()

  const executable = getFfmpegPath()
  const args = buildAudioArgs(task)
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
        if (key !== 'out_time_us') continue
        const progress = (Number(value) / (probe.duration * 1_000_000)) * 100
        if (Number.isFinite(progress)) onProgress(Math.min(99, Math.max(0, progress)))
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
          new MediaProcessError('音频处理失败', {
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
