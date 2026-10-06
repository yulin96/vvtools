/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  cpSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { spawnSync } from 'node:child_process'
import extract from 'extract-zip'

const FFMPEG_VERSION = '9.0.2'
const QPDF_VERSION = '12.4.2'
const FONTTOOLS_VERSION = '4.66.1'
const require = createRequire(import.meta.url)
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

const qpdfPlatforms = {
  'win32-x64': {
    url: 'https://github.com/qpdf/qpdf/releases/download/v12.4.2/qpdf-12.4.2-mingw64.zip',
    sha256: '773d2fa0c7d161e2271430734338e560a07b25d0edf11ceee8e53de435012766'
  },
  'darwin-x64': {
    url: 'https://github.com/qpdf/qpdf/releases/download/v12.4.2/qpdf-12.4.2-bin-macos-x86_64.zip',
    sha256: 'dd3b01f4414d198529bb0f13bba59c2f016a328bb3506695087a96fb80fc1481'
  },
  'darwin-arm64': {
    url: 'https://github.com/qpdf/qpdf/releases/download/v12.4.2/qpdf-12.4.2-bin-macos-arm64.zip',
    sha256: '62e46987a30ea167cbc530ccb22690aec3d8c812ed09979a941bcee92e504b79'
  },
  'linux-x64': {
    url: 'https://github.com/qpdf/qpdf/releases/download/v12.4.2/qpdf-12.4.2-bin-linux-x86_64.zip',
    sha256: 'db367d897829f22c4198ce1094143c9d467bd6ee7dfabc44ba6f02056b24f8b1'
  }
}

const fonttoolsWheel = {
  url: 'https://files.pythonhosted.org/packages/f6/10/d45b74135d5d642cb3a4fb0a957c1613ef93de4c8548671dfc3a5bf38299/fonttools-4.66.1-py3-none-any.whl',
  sha256: '7234ae9e28db64273fbbfa72caebd0a97e3bdba6b05064114741b9539ef339d0'
}

/** @returns {Promise<string>} */
async function sha256(path) {
  const hash = createHash('sha256')
  if (!statSync(path).isFile()) throw new Error(`${path} 不是有效文件`)
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

/** @returns {Promise<string>} */
async function downloadArchive(source, label) {
  mkdirSync(cacheDirectory, { recursive: true })
  const cachePath = join(
    cacheDirectory,
    `${source.sha256}-${basename(new URL(source.url).pathname)}`
  )
  if (existsSync(cachePath) && (await sha256(cachePath)) === source.sha256) return cachePath

  rmSync(cachePath, { force: true })
  const response = await fetch(source.url)
  if (!response.ok || !response.body) {
    throw new Error(`下载 ${label} 失败：${response.status} ${response.statusText}`)
  }
  process.stdout.write(`Downloading ${label}...\n`)
  await pipeline(Readable.fromWeb(response.body), createWriteStream(cachePath))
  const actualHash = await sha256(cachePath)
  if (actualHash !== source.sha256) {
    rmSync(cachePath, { force: true })
    throw new Error(`${label} 下载校验失败：预期 ${source.sha256}，实际 ${actualHash}`)
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

async function stageQpdf(stagingDirectory, extractionDirectory, source) {
  const archive = await downloadArchive(source, `qpdf ${QPDF_VERSION}`)
  const extracted = join(extractionDirectory, 'qpdf')
  await extract(archive, { dir: extracted })
  const name = process.platform === 'win32' ? 'qpdf.exe' : 'qpdf'
  const executable = findBinary(extracted, name)
  if (!executable) throw new Error(`qpdf 下载包中缺少 ${name}`)
  const packageRoot = dirname(dirname(executable))
  const target = join(stagingDirectory, 'qpdf')
  mkdirSync(target, { recursive: true })
  for (const directory of ['bin', ...(process.platform === 'win32' ? [] : ['lib'])]) {
    const path = join(packageRoot, directory)
    if (existsSync(path))
      cpSync(path, join(target, directory), { recursive: true, verbatimSymlinks: true })
  }
  copyFileSync(join(root, 'build', 'licenses', 'qpdf-LICENSE.txt'), join(target, 'LICENSE.txt'))
  const binary = join(target, 'bin', name)
  if (process.platform !== 'win32') chmodSync(binary, 0o755)
  const result = spawnSync(binary, ['--version'], { encoding: 'utf8', windowsHide: true })
  const version = result.stdout?.split(/\r?\n/u)[0] || ''
  if (result.status !== 0 || version !== `qpdf version ${QPDF_VERSION}`)
    throw new Error(
      `qpdf 版本校验失败：${result.error?.message || result.stderr?.trim() || version}`
    )
  return version
}

async function stageFonttools(stagingDirectory) {
  const moduleDirectory = dirname(require.resolve('@web-alchemy/fonttools'))
  const packageDirectory = join(moduleDirectory, '..', 'python_modules')
  const lockPath = require.resolve('pyodide/pyodide-lock.json', { paths: [moduleDirectory] })
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
  const target = join(stagingDirectory, 'fonttools')
  mkdirSync(target, { recursive: true })
  for (const name of ['brotli', 'lxml']) {
    const entry = lock.packages[name]
    const source = join(packageDirectory, entry.file_name)
    if ((await sha256(source)) !== entry.sha256) throw new Error(`${name} wheel 完整性校验失败`)
    copyFileSync(source, join(target, entry.file_name))
  }
  const archive = await downloadArchive(fonttoolsWheel, `FontTools ${FONTTOOLS_VERSION}`)
  const fileName = basename(new URL(fonttoolsWheel.url).pathname)
  copyFileSync(archive, join(target, fileName))
  Object.assign(lock.packages.fonttools, {
    file_name: fileName,
    sha256: fonttoolsWheel.sha256,
    version: FONTTOOLS_VERSION
  })
  writeFileSync(join(target, 'pyodide-lock.json'), JSON.stringify(lock), 'utf8')
}

const platformKey = `${process.platform}-${process.arch}`
const sources = platforms[platformKey]
if (!sources) throw new Error(`当前平台 ${platformKey} 没有固定的 FFmpeg ${FFMPEG_VERSION} 二进制`)
const qpdfSource = qpdfPlatforms[platformKey]
if (!qpdfSource) throw new Error(`当前平台 ${platformKey} 没有固定的 qpdf ${QPDF_VERSION} 二进制`)

const stagingDirectory = join(mediaRoot, `staging-${process.pid}`)
const extractionDirectory = join(stagingDirectory, 'extract')
rmSync(stagingDirectory, { recursive: true, force: true })
mkdirSync(extractionDirectory, { recursive: true })

try {
  const archives = []
  for (const [index, source] of sources.entries()) {
    const archive = await downloadArchive(source, `FFmpeg ${FFMPEG_VERSION} archive ${index + 1}`)
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
  versions.push(await stageQpdf(stagingDirectory, extractionDirectory, qpdfSource))
  await stageFonttools(stagingDirectory)
  versions.push(`FontTools ${FONTTOOLS_VERSION} (Pyodide)`)

  writeFileSync(
    join(stagingDirectory, 'BUILD_INFO.txt'),
    [
      'VVTools bundled media runtime',
      `Platform: ${platformKey}`,
      ...versions,
      '',
      'Pinned archives:',
      ...sources.map((source) => `${source.sha256}  ${source.url}`),
      `${qpdfSource.sha256}  ${qpdfSource.url}`,
      `${fonttoolsWheel.sha256}  ${fonttoolsWheel.url}`,
      '',
      `FFmpeg source: https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz`,
      'FFmpeg license: https://ffmpeg.org/legal.html',
      `qpdf source: https://github.com/qpdf/qpdf/tree/v${QPDF_VERSION}`,
      'qpdf license: https://github.com/qpdf/qpdf/blob/v12.4.2/LICENSE.txt',
      ''
    ].join('\n'),
    'utf8'
  )

  rmSync(extractionDirectory, { recursive: true, force: true })
  rmSync(destination, { recursive: true, force: true })
  renameSync(stagingDirectory, destination)
  console.log(
    `Staged FFmpeg ${FFMPEG_VERSION}, qpdf ${QPDF_VERSION} and FontTools ${FONTTOOLS_VERSION} for ${platformKey}`
  )
} catch (error) {
  rmSync(stagingDirectory, { recursive: true, force: true })
  throw error
}
