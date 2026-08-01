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

const childSource = String.raw`
const { readFile, writeFile } = require('node:fs/promises')

async function readRequest() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function main() {
  const request = await readRequest()
  const { subset, instantiateVariableFont } = require(request.fonttoolsModulePath)
  let input = await readFile(request.sourcePath)
  if (request.staticAxes) input = await instantiateVariableFont(input, request.staticAxes)
  const output = await subset(input, request.subsetOptions)
  if (!output.byteLength) throw new Error('字体处理器没有生成有效输出')
  await writeFile(request.outputPath, Buffer.from(output))
  process.stdout.write(JSON.stringify({ outputSize: output.byteLength }))
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
`

export function runFontProcess(
  request: FontProcessRequest,
  signal: AbortSignal,
  fonttoolsModulePath = require.resolve('@web-alchemy/fonttools')
): Promise<number> {
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
          const result = JSON.parse(stdout) as { outputSize?: number }
          if (!result.outputSize) throw new Error('字体处理进程没有返回有效输出信息')
          resolve(result.outputSize)
        } catch (error) {
          reject(error)
        }
      })
    })
    child.stdin.end(
      JSON.stringify({
        ...request,
        fonttoolsModulePath
      })
    )
  })
}
