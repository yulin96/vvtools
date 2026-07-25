import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildAudioArgs, processAudio } from '../src/main/media/audio-processor'
import { DEFAULT_AUDIO_OPTIONS } from '../src/shared/constants'
import type { AudioOptions, MediaTask } from '../src/shared/types'
import { FailureLogService } from '../src/main/services/failure-log'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function task(options: Partial<AudioOptions> = {}): MediaTask {
  return {
    id: 'audio',
    kind: 'audio',
    sourcePath: '/input/source.mp4',
    outputPath: '/output/source.mp3',
    status: 'pending',
    progress: 0,
    options: { ...DEFAULT_AUDIO_OPTIONS, ...options },
    sourceSize: 1,
    createdAt: new Date(0).toISOString()
  }
}

describe('audio command', () => {
  it('extracts the first audio track and encodes MP3', () => {
    const args = buildAudioArgs(task())
    expect(args).toContain('-vn')
    expect(args.slice(args.indexOf('-map'), args.indexOf('-map') + 2)).toEqual(['-map', '0:a:0'])
    expect(args.slice(args.indexOf('-c:a'), args.indexOf('-c:a') + 4)).toEqual([
      '-c:a',
      'libmp3lame',
      '-b:a',
      '192k'
    ])
  })

  it('supports loudness normalization, mono output and M4A fast start', () => {
    const args = buildAudioArgs(
      task({ format: 'm4a', bitrateKbps: 128, channels: 'mono', normalizeLoudness: true })
    )
    expect(args).toContain('loudnorm=I=-16:LRA=11:TP=-1.5')
    expect(args.slice(args.indexOf('-ac'), args.indexOf('-ac') + 2)).toEqual(['-ac', '1'])
    expect(args).toContain('+faststart')
  })

  it('does not apply a lossy bitrate to WAV output', () => {
    const args = buildAudioArgs(task({ format: 'wav' }))
    expect(args).toContain('pcm_s16le')
    expect(args).not.toContain('-b:a')
  })

  it('converts a WAV fixture to MP3 through the packaged FFmpeg runtime', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vvtools-audio-'))
    directories.push(root)
    const sourcePath = join(root, 'source.wav')
    const outputPath = join(root, 'output.mp3')
    writeFileSync(sourcePath, silentWav())
    const mediaTask = task()
    mediaTask.sourcePath = sourcePath
    mediaTask.outputPath = outputPath

    expect(
      await processAudio(
        mediaTask,
        new AbortController().signal,
        () => undefined,
        new FailureLogService(root)
      )
    ).toBeGreaterThan(0)
  })
})

function silentWav(): Buffer {
  const sampleRate = 8000
  const samples = 800
  const dataSize = samples * 2
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)
  return buffer
}
