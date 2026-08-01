import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TaskCancelledError } from '../src/main/media/errors'
import { runFontProcess } from '../src/main/media/font-process'

describe('font process', () => {
  let fixtureDirectory = ''
  let fonttoolsModulePath = ''
  let sourcePath = ''

  beforeAll(async () => {
    fixtureDirectory = await mkdtemp(join(tmpdir(), 'vvtools-font-process-'))
    fonttoolsModulePath = join(fixtureDirectory, 'fonttools.cjs')
    sourcePath = join(fixtureDirectory, 'input.ttf')
    await writeFile(sourcePath, Uint8Array.from([1, 2]))
    await writeFile(
      fonttoolsModulePath,
      `
module.exports = {
  async instantiateVariableFont(input) {
    return input
  },
  async subset(input, options) {
    const duration = Number(options.busyTime || 0)
    const started = Date.now()
    while (Date.now() - started < duration) {}
    return Uint8Array.from([...input, Number(options.marker || 0)])
  }
}
`
    )
  })

  afterAll(async () => {
    await rm(fixtureDirectory, { recursive: true, force: true })
  })

  it('keeps the caller event loop responsive during synchronous font work', async () => {
    const outputPath = join(fixtureDirectory, 'output.woff2')
    let timerFired = false
    const timer = setTimeout(() => {
      timerFired = true
    }, 20)

    const outputSize = await runFontProcess(
      {
        sourcePath,
        outputPath,
        subsetOptions: { busyTime: 150, marker: 3 }
      },
      new AbortController().signal,
      fonttoolsModulePath
    )

    clearTimeout(timer)
    expect(timerFired).toBe(true)
    expect(outputSize).toBe(3)
    expect([...(await readFile(outputPath))]).toEqual([1, 2, 3])
  })

  it('terminates the process when the task is cancelled', async () => {
    const controller = new AbortController()
    const processing = runFontProcess(
      {
        sourcePath,
        outputPath: join(fixtureDirectory, 'cancelled.woff2'),
        subsetOptions: { busyTime: 2_000 }
      },
      controller.signal,
      fonttoolsModulePath
    )
    setTimeout(() => controller.abort(), 20)

    await expect(processing).rejects.toBeInstanceOf(TaskCancelledError)
  })
})
