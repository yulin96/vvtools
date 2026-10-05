import { randomUUID } from 'crypto'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { isDesktopLaunch, readDesktopLaunch, validateDesktopRequest } from './desktop-request'

const roots: string[] = []
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'vvtools-desktop-request-'))
  roots.push(root)
  return root
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('desktop launch requests', () => {
  it('preserves literal filenames and selection order without interpreting options or shell text', async () => {
    const paths = ['/tmp/中文 图片 $(touch nope).png', "/tmp/a'b & c.png"]
    expect(isDesktopLaunch(['vvtools'])).toBe(false)
    expect(isDesktopLaunch(['vvtools', '--vvtools-action=image-share'])).toBe(true)
    const request = await readDesktopLaunch(
      ['vvtools', '--vvtools-action=image-share', '--', ...paths, paths[0]],
      '/tmp'
    )
    expect(request).toEqual({ version: 1, id: expect.any(String), actionId: 'image-share', paths })
    await expect(
      readDesktopLaunch(['--vvtools-action=image-share', ...paths], '/tmp')
    ).rejects.toThrow('缺少文件列表')
  })
  it('consumes a single grouped request and removes the envelope after parsing', async () => {
    const root = await fixture()
    const request = {
      version: 1,
      id: randomUUID(),
      actionId: 'image-web',
      paths: ['/tmp/first.png', '/tmp/second.png']
    }
    const path = join(root, request.id + '.json')
    await writeFile(path, JSON.stringify(request))
    await expect(readDesktopLaunch(['vvtools', '--vvtools-request', path], root)).resolves.toEqual(
      request
    )
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('rejects outside files and symlinks without removing their targets', async () => {
    const root = await fixture()
    const outside = await fixture()
    const file = join(outside, randomUUID() + '.json')
    await writeFile(file, '{}')
    await expect(readDesktopLaunch(['--vvtools-request', file], root)).rejects.toThrow('位置无效')
    const link = join(root, randomUUID() + '.json')
    await symlink(outside, link, 'junction')
    await expect(readDesktopLaunch(['--vvtools-request', link], root)).rejects.toThrow('文件无效')
    await expect(readFile(file, 'utf8')).resolves.toBe('{}')
  })
  it('rejects excessive selections, invalid IDs, relative paths, and unknown actions', () => {
    const valid = {
      version: 1,
      id: randomUUID(),
      actionId: 'image-share',
      paths: ['/tmp/photo.png']
    }
    for (const patch of [
      { id: '-'.repeat(36) },
      { actionId: 'overwrite' },
      { paths: ['photo.png'] },
      { paths: ['/tmp/a\0.png'] },
      { paths: [] },
      { paths: Array(501).fill('/tmp/photo.png') }
    ])
      expect(() => validateDesktopRequest({ ...valid, ...patch })).toThrow('快捷处理请求无效')
  })
  it('removes malformed envelopes so a broken request cannot replay on the next launch', async () => {
    const root = await fixture()
    const file = join(root, randomUUID() + '.json')
    await writeFile(file, '{"version":1}')
    await expect(readDesktopLaunch(['--vvtools-request', file], root)).rejects.toThrow(
      '快捷处理请求无效'
    )
    await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
