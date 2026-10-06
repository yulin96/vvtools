import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MediaProcessPool } from './process-pool'
import { TaskCancelledError } from './errors'

const pools: MediaProcessPool[] = []
const roots: string[] = []
afterEach(async () => {
  for (const pool of pools.splice(0)) pool.shutdown()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function fixture(maximum = 2): Promise<{ pool: MediaProcessPool; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'vvtools-process-pool-'))
  roots.push(root)
  const path = join(root, 'worker.cjs')
  await writeFile(
    path,
    `
    const fs = require('node:fs')
    process.on('message', request => {
      if (request.started) fs.writeFileSync(request.started, 'started')
      const start = Date.now()
      while (Date.now() - start < request.busyTime) {}
      if (request.output) fs.writeFileSync(request.output, 'finished')
      process.send({ ok: true, result: { pid: process.pid, marker: request.marker } })
    })
  `
  )
  const pool = new MediaProcessPool(path, maximum)
  pools.push(pool)
  return { pool, root }
}

describe('bounded background processes', () => {
  it('keeps the parent responsive and reuses at most two processes', async () => {
    const { pool } = await fixture()
    let timerFired = false
    const timer = setTimeout(() => {
      timerFired = true
    }, 20)
    const results = await Promise.all(
      [1, 2, 3].map((marker) =>
        pool.run<{ pid: number; marker: number }>({ busyTime: 100, marker })
      )
    )
    clearTimeout(timer)
    expect(timerFired).toBe(true)
    expect(results.map((result) => result.marker)).toEqual([1, 2, 3])
    expect(new Set(results.map((result) => result.pid)).size).toBe(2)
    expect([results[0].pid, results[1].pid]).toContain(results[2].pid)
  })

  it('terminates a running process and releases its slot on cancellation', async () => {
    const { pool, root } = await fixture(1)
    const controller = new AbortController()
    const started = join(root, 'started')
    const output = join(root, 'output')
    const processing = pool.run({ busyTime: 2000, started, output }, controller.signal)
    const rejected = expect(processing).rejects.toBeInstanceOf(TaskCancelledError)
    await vi.waitFor(async () => expect(await readFile(started, 'utf8')).toBe('started'))
    controller.abort()
    await rejected
    await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await pool.run({ busyTime: 0, marker: 4 })).toMatchObject({ marker: 4 })
  })

  it('cancels queued work without disturbing the running request', async () => {
    const { pool } = await fixture(1)
    const first = pool.run({ busyTime: 100, marker: 1 })
    const controller = new AbortController()
    const queued = pool.run({ busyTime: 0, marker: 2 }, controller.signal)
    const rejected = expect(queued).rejects.toBeInstanceOf(TaskCancelledError)
    controller.abort()
    await rejected
    expect(await first).toMatchObject({ marker: 1 })
    expect(await pool.run({ busyTime: 0, marker: 3 })).toMatchObject({ marker: 3 })
  })
})
