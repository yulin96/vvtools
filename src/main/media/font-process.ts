import { spawn } from 'child_process'
import { createRequire } from 'module'
import { TaskCancelledError } from './errors'

const require = createRequire(import.meta.url)

export interface FontProcessRequest {
  sourcePath: string
  outputPath: string
  subsetOptions: Record<string, unknown>
  staticAxes?: Record<string, [number, number]>
}

type FontWorkerRequest = ({ command: 'process' } & FontProcessRequest) | { command: 'version' }

interface FontWorkerResult {
  version: string
  outputSize?: number
}

const childSource = String.raw`
const { access, readFile, writeFile } = require('node:fs/promises')
const { dirname, join } = require('node:path')

async function readRequest() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function main() {
  const request = await readRequest()
  const lockFileURL = join(request.packageDirectory, 'pyodide-lock.json')
  const lock = JSON.parse(await readFile(lockFileURL, 'utf8'))
  if (lock.packages.fonttools.version !== '4.66.1') throw new Error('FontTools 资源版本不是 4.66.1')
  for (const name of ['brotli', 'fonttools', 'lxml']) {
    await access(join(request.packageDirectory, lock.packages[name].file_name))
  }
  const { preparePyodide } = require(join(dirname(request.fonttoolsModulePath), 'pyodide.js'))
  const pyodide = await preparePyodide({
    lockFileURL,
    packageCacheDir: request.packageDirectory,
    packageBaseUrl: request.packageDirectory + '/',
    stdout: () => undefined,
    stderr: (message) => process.stderr.write(message + '\n')
  })
  const version = pyodide.runPython('import fontTools\nfontTools.version')
  if (version !== '4.66.1') throw new Error('FontTools 实际加载版本不匹配：' + version)
  if (request.command === 'version') {
    process.stdout.write(JSON.stringify({ version }))
    return
  }
  const { subset, instantiateVariableFont } = require(request.fonttoolsModulePath)
  let input = await readFile(request.sourcePath)
  if (request.staticAxes) input = await instantiateVariableFont(input, request.staticAxes)
  const output = await subset(input, request.subsetOptions)
  if (!output.byteLength) throw new Error('字体处理器没有生成有效输出')
  await writeFile(request.outputPath, Buffer.from(output))
  process.stdout.write(JSON.stringify({ version, outputSize: output.byteLength }))
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
`

export async function runFontProcess(
  request: FontProcessRequest,
  signal: AbortSignal,
  packageDirectory: string,
  fonttoolsModulePath = require.resolve('@web-alchemy/fonttools')
): Promise<number> {
  const result = await runFontWorker(
    { ...request, command: 'process' },
    signal,
    fonttoolsModulePath,
    packageDirectory
  )
  return result.outputSize!
}

export async function getFonttoolsVersion(packageDirectory: string): Promise<string> {
  const result = await runFontWorker(
    { command: 'version' },
    new AbortController().signal,
    require.resolve('@web-alchemy/fonttools'),
    packageDirectory
  )
  return result.version
}

function runFontWorker(
  request: FontWorkerRequest,
  signal: AbortSignal,
  fonttoolsModulePath: string,
  packageDirectory: string
): Promise<FontWorkerResult> {
  if (signal.aborted) return Promise.reject(new TaskCancelledError())

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', childSource], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true
    })
    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', handleAbort)
      callback()
    }
    const handleAbort = (): void => {
      child.kill()
      finish(() => reject(new TaskCancelledError()))
    }

    signal.addEventListener('abort', handleAbort, { once: true })
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.once('error', (error) => finish(() => reject(error)))
    child.once('close', (code) => {
      finish(() => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || `字体处理进程异常退出（${code ?? '未知'}）`))
          return
        }
        try {
          const result = JSON.parse(stdout) as FontWorkerResult
          if (result.version !== '4.66.1') throw new Error('字体处理进程没有返回正确的引擎版本')
          if (request.command === 'process' && !result.outputSize)
            throw new Error('字体处理进程没有返回有效输出信息')
          resolve(result)
        } catch (error) {
          reject(error)
        }
      })
    })
    child.stdin.end(
      JSON.stringify({
        ...request,
        fonttoolsModulePath,
        packageDirectory
      })
    )
  })
}
