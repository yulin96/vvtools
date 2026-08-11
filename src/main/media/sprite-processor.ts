import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { mkdirSync, rmSync, statSync } from 'fs'
import type { MediaTask, SpriteOptions, TaskCommand } from '../../shared/types'
import { FailureLogService } from '../services/failure-log'
import { MediaProcessError, TaskCancelledError } from './errors'
import { getFfmpegPath } from './ffmpeg-runtime'
import { probeVideo, type VideoProbe } from './video-processor'

export interface SpritePlan {
  duration: number
  intervalSeconds: number
  frameCount: number
  framesPerSheet: number
  sheetCount: number
  frameWidth: number
  frameHeight: number
  sheetWidth: number
  sheetHeight: number
}

export function createSpritePlan(options: SpriteOptions, probe: VideoProbe): SpritePlan {
  const rangeEnd =
    options.endTimeSeconds > 0 ? Math.min(options.endTimeSeconds, probe.duration) : probe.duration
  const duration = rangeEnd - options.startTimeSeconds
  if (duration <= 0) throw new Error('采样开始时间超出视频时长')

  const sourceFrameCount = probe.frameCount
  if (options.samplingMode === 'frame' && !sourceFrameCount) {
    throw new Error('无法读取视频帧数，不能按帧抽取')
  }
  const intervalSeconds =
    options.samplingMode === 'count'
      ? duration / options.frameCount
      : options.samplingMode === 'frame'
        ? (duration / sourceFrameCount!) * options.frameStep
        : options.intervalSeconds
  const frameCount =
    options.samplingMode === 'count'
      ? options.frameCount
      : options.samplingMode === 'frame'
        ? Math.ceil(sourceFrameCount! / options.frameStep)
        : Math.max(1, Math.ceil(duration / intervalSeconds))
  const maximumFrameCount = options.samplingMode === 'frame' ? 100_000 : 10_000
  if (frameCount > maximumFrameCount) {
    throw new Error(`采样帧数超过 ${maximumFrameCount}，请增大抽帧步长、采样间隔或缩短时间范围`)
  }

  const framesPerSheet =
    options.exportMode === 'single' ? frameCount : Math.min(frameCount, options.framesPerSheet)
  const frameHeight = Math.max(
    1,
    Math.round(
      (options.frameWidth * (probe.height ?? options.frameWidth)) /
        (probe.width ?? options.frameWidth)
    )
  )
  const columns = Math.min(options.columns, framesPerSheet)
  const rows = Math.ceil(framesPerSheet / columns)
  const sheetWidth =
    options.margin * 2 + columns * options.frameWidth + Math.max(0, columns - 1) * options.padding
  const sheetHeight =
    options.margin * 2 + rows * frameHeight + Math.max(0, rows - 1) * options.padding
  if (sheetWidth > 32_768 || sheetHeight > 32_768) {
    throw new Error(
      `雪碧图尺寸 ${sheetWidth} × ${sheetHeight} 超过 32768 像素，请减小帧宽、列数或每张帧数`
    )
  }
  return {
    duration,
    intervalSeconds,
    frameCount,
    framesPerSheet,
    sheetCount: Math.ceil(frameCount / framesPerSheet),
    frameWidth: options.frameWidth,
    frameHeight,
    sheetWidth,
    sheetHeight
  }
}

function taskCommand(executable: string, args: string[]): TaskCommand {
  return {
    executable,
    args: [...args],
    display: [executable, ...args].map((value) => JSON.stringify(value)).join(' ')
  }
}

export function buildSpriteArgs(
  task: MediaTask,
  options: SpriteOptions,
  plan: SpritePlan,
  sheetIndex: number,
  outputPath: string
): string[] {
  const firstFrame = sheetIndex * plan.framesPerSheet
  const frames = Math.min(plan.framesPerSheet, plan.frameCount - firstFrame)
  const columns = Math.min(options.columns, frames)
  const rows = Math.ceil(frames / columns)
  const samplesByFrame = options.samplingMode === 'frame'
  const start = samplesByFrame
    ? options.startTimeSeconds
    : options.startTimeSeconds + firstFrame * plan.intervalSeconds
  const duration = samplesByFrame
    ? plan.duration
    : Math.min(plan.duration - firstFrame * plan.intervalSeconds, frames * plan.intervalSeconds)
  const firstSourceFrame = firstFrame * options.frameStep
  const lastSourceFrame = firstSourceFrame + (frames - 1) * options.frameStep
  const filter = [
    samplesByFrame
      ? `select='between(n\\,${firstSourceFrame}\\,${lastSourceFrame})*not(mod(n\\,${options.frameStep}))',setpts=N/FRAME_RATE/TB`
      : `fps=1/${plan.intervalSeconds}`,
    `scale=${plan.frameWidth}:-1:flags=lanczos`,
    `tile=${columns}x${rows}:nb_frames=${frames}:padding=${options.padding}:margin=${options.margin}:color=0x${options.backgroundColor.slice(1)}`
  ].join(',')
  const args = [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-ss',
    String(start),
    '-t',
    String(samplesByFrame ? duration : Math.max(plan.intervalSeconds, duration)),
    '-i',
    task.sourcePath,
    '-vf',
    filter,
    '-frames:v',
    '1'
  ]
  if (options.imageFormat === 'jpeg') {
    const qscale = Math.max(2, Math.min(31, Math.round(31 - (options.quality / 100) * 29)))
    args.push('-q:v', String(qscale))
  } else if (options.imageFormat === 'webp') {
    args.push('-quality', String(options.quality))
  } else {
    args.push('-compression_level', '9')
  }
  args.push('-progress', 'pipe:1', '-nostats', outputPath)
  return args
}

async function renderSheet(
  task: MediaTask,
  options: SpriteOptions,
  plan: SpritePlan,
  sheetIndex: number,
  outputPath: string,
  signal: AbortSignal,
  failureLogs: FailureLogService
): Promise<number> {
  const executable = getFfmpegPath()
  const args = buildSpriteArgs(task, options, plan, sheetIndex, outputPath)
  const command = taskCommand(executable, args)
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
    const cancel = (): void => {
      child.kill()
    }
    signal.addEventListener('abort', cancel, { once: true })
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
        return reject(new TaskCancelledError())
      }
      if (code !== 0) {
        log.stream.end()
        return reject(
          new MediaProcessError('雪碧图导出失败', {
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
  return statSync(outputPath).size
}

export async function processSprite(
  task: MediaTask,
  signal: AbortSignal,
  onProgress: (progress: number) => void,
  failureLogs: FailureLogService
): Promise<number> {
  const options = task.options as SpriteOptions
  const outputPaths = task.outputPaths ?? []
  const probe = await probeVideo(task.sourcePath, signal)
  probe.frameCount = task.sourceFrameCount
  const plan = createSpritePlan(options, probe)
  if (outputPaths.length !== plan.sheetCount) throw new Error('雪碧图输出数量与采样计划不匹配')
  mkdirSync(task.outputPath, { recursive: true })
  let outputSize = 0
  try {
    for (let index = 0; index < outputPaths.length; index += 1) {
      if (signal.aborted) throw new TaskCancelledError()
      outputSize += await renderSheet(
        task,
        options,
        plan,
        index,
        outputPaths[index],
        signal,
        failureLogs
      )
      onProgress(Math.round(((index + 1) / outputPaths.length) * 100))
    }
    return outputSize
  } catch (error) {
    rmSync(task.outputPath, { recursive: true, force: true })
    throw error
  }
}
