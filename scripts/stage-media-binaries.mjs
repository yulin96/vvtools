import { createRequire } from 'node:module'
import { chmodSync, copyFileSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const ffmpegPath = require('ffmpeg-static')
const ffprobePath = require('@derhuerst/ffprobe-static')
const destination = join(process.cwd(), '.media-bin', 'current')

if (!ffmpegPath || !ffprobePath) {
  throw new Error(`当前平台 ${process.platform}-${process.arch} 缺少 FFmpeg 或 FFprobe 二进制`)
}
if (!statSync(ffmpegPath).isFile() || !statSync(ffprobePath).isFile()) {
  throw new Error('FFmpeg 或 FFprobe 二进制尚未安装，请先执行 pnpm install')
}

rmSync(destination, { recursive: true, force: true })
mkdirSync(destination, { recursive: true })
const extension = process.platform === 'win32' ? '.exe' : ''
const files = [
  [ffmpegPath, join(destination, `ffmpeg${extension}`)],
  [ffprobePath, join(destination, `ffprobe${extension}`)]
]

for (const [source, target] of files) {
  copyFileSync(source, target)
  if (process.platform !== 'win32') chmodSync(target, 0o755)
}

console.log(`Staged media binaries for ${process.platform}-${process.arch}`)
