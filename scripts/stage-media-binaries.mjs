/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { spawnSync } from 'node:child_process'
import extract from 'extract-zip'

const FFMPEG_VERSION = '9.0.2'
const root = process.cwd()
const mediaRoot = join(root, '.media-bin')
const destination = join(mediaRoot, 'current')
const cacheDirectory = join(mediaRoot, 'cache')

const platforms = {
  'win32-x64': [
    {
      url: 'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip',
      sha256: '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba',
      binaries: ['ffmpeg.exe', 'ffprobe.exe']
    }
  ],
  'darwin-x64': [
    {
      url: 'https://ffmpeg.martin-riedl.de/download/macos/amd64/1789931006_9.0.2/ffmpeg.zip',
      sha256: '7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4',
      binaries: ['ffmpeg']
    },
    {
      url: 'https://ffmpeg.martin-riedl.de/download/macos/amd64/1789931006_9.0.2/ffprobe.zip',
      sha256: '2322438ed2f6319a691291b247d09c69dcaa3a982460d1f269a7e1af335cfdfd',
      binaries: ['ffprobe']
    }
  ],
  'darwin-arm64': [
    {
      url: 'https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/ffmpeg.zip',
      sha256: 'c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924',
      binaries: ['ffmpeg']
    },
    {
      url: 'https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/ffprobe.zip',
      sha256: 'fcbe839537485eaee7a7a8bc5cbc0f90d53617e80943e8a5b2e31cb851197ea6',
      binaries: ['ffprobe']
    }
  ],
  'linux-x64': [
    {
      url: 'https://ffmpeg.martin-riedl.de/download/linux/amd64/1789931100_9.0.2/ffmpeg.zip',
      sha256: 'fa8ecf4abbd290d98f7d188b8649cc6b391ae209a98452be955a15aab1909d7f',
      binaries: ['ffmpeg']
    },
    {
      url: 'https://ffmpeg.martin-riedl.de/download/linux/amd64/1789931100_9.0.2/ffprobe.zip',
      sha256: '3f428c49070be3d24ec338602b76d412e401ffcb8a5641ef0e729181a232fc32',
      binaries: ['ffprobe']
    }
  ]
}

/** @returns {Promise<string>} */
async function sha256(path) {
  const hash = createHash('sha256')
  if (!statSync(path).isFile()) throw new Error(`${path} 不是有效文件`)
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

/** @returns {Promise<string>} */
async function downloadArchive(source, index) {
  mkdirSync(cacheDirectory, { recursive: true })
  const cachePath = join(
    cacheDirectory,
    `${source.sha256}-${basename(new URL(source.url).pathname)}`
  )
  if (existsSync(cachePath) && (await sha256(cachePath)) === source.sha256) return cachePath

  rmSync(cachePath, { force: true })
  const response = await fetch(source.url)
  if (!response.ok || !response.body) {
    throw new Error(`下载 FFmpeg 失败：${response.status} ${response.statusText}`)
  }
  process.stdout.write(`Downloading FFmpeg ${FFMPEG_VERSION} archive ${index + 1}...\n`)
  await pipeline(Readable.fromWeb(response.body), createWriteStream(cachePath))
  const actualHash = await sha256(cachePath)
  if (actualHash !== source.sha256) {
    rmSync(cachePath, { force: true })
    throw new Error(`FFmpeg 下载校验失败：预期 ${source.sha256}，实际 ${actualHash}`)
  }
  return cachePath
}

/** @returns {string | undefined} */
function findBinary(directory, name) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isFile() && entry.name === name) return path
    if (entry.isDirectory()) {
      const nested = findBinary(path, name)
      if (nested) return nested
    }
  }
  return undefined
}

/** @returns {string} */
function verifyBinary(path, name) {
  const result = spawnSync(path, ['-version'], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) {
    throw new Error(`${name} 无法运行：${result.stderr?.trim() || `退出码 ${result.status}`}`)
  }
  const firstLine = result.stdout.split(/\r?\n/u)[0] || ''
  if (!firstLine.includes(`${name} version ${FFMPEG_VERSION}`)) {
    throw new Error(`${name} 版本不匹配：${firstLine || '无版本信息'}`)
  }
  return firstLine
}

const platformKey = `${process.platform}-${process.arch}`
const sources = platforms[platformKey]
if (!sources) throw new Error(`当前平台 ${platformKey} 没有固定的 FFmpeg ${FFMPEG_VERSION} 二进制`)

const stagingDirectory = join(mediaRoot, `staging-${process.pid}`)
const extractionDirectory = join(stagingDirectory, 'extract')
rmSync(stagingDirectory, { recursive: true, force: true })
mkdirSync(extractionDirectory, { recursive: true })

try {
  const archives = []
  for (const [index, source] of sources.entries()) {
    const archive = await downloadArchive(source, index)
    const archiveDirectory = join(extractionDirectory, String(index))
    mkdirSync(archiveDirectory, { recursive: true })
    await extract(archive, { dir: archiveDirectory })
    archives.push({ ...source, directory: archiveDirectory })
  }

  const extension = process.platform === 'win32' ? '.exe' : ''
  const versions = []
  for (const name of ['ffmpeg', 'ffprobe']) {
    const fileName = `${name}${extension}`
    const source = archives
      .filter((archive) => archive.binaries.includes(fileName))
      .map((archive) => findBinary(archive.directory, fileName))
      .find(Boolean)
    if (!source) throw new Error(`下载包中缺少 ${fileName}`)
    const target = join(stagingDirectory, fileName)
    copyFileSync(source, target)
    if (process.platform !== 'win32') chmodSync(target, 0o755)
    versions.push(verifyBinary(target, name))
  }

  writeFileSync(
    join(stagingDirectory, 'BUILD_INFO.txt'),
    [
      'VVTools bundled media runtime',
      `Platform: ${platformKey}`,
      ...versions,
      '',
      'Pinned archives:',
      ...sources.map((source) => `${source.sha256}  ${source.url}`),
      '',
      `FFmpeg source: https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz`,
      'FFmpeg license: https://ffmpeg.org/legal.html',
      ''
    ].join('\n'),
    'utf8'
  )

  rmSync(extractionDirectory, { recursive: true, force: true })
  rmSync(destination, { recursive: true, force: true })
  renameSync(stagingDirectory, destination)
  console.log(`Staged FFmpeg ${FFMPEG_VERSION} for ${platformKey}`)
} catch (error) {
  rmSync(stagingDirectory, { recursive: true, force: true })
  throw error
}
