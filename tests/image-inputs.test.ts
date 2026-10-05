import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectImageInputs } from '../src/main/media/image-inputs'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('image inputs', () => {
  it('expands folders and keeps relative directory structure', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vvtools-inputs-'))
    directories.push(root)
    const album = join(root, 'album')
    mkdirSync(join(album, 'day-1'), { recursive: true })
    writeFileSync(join(album, 'cover.jpg'), 'image')
    writeFileSync(join(album, 'day-1', 'photo.png'), 'image')
    writeFileSync(join(album, 'notes.txt'), 'ignored')

    expect(await collectImageInputs([album])).toEqual([
      { path: join(album, 'cover.jpg'), relativeDirectory: 'album' },
      { path: join(album, 'day-1', 'photo.png'), relativeDirectory: join('album', 'day-1') }
    ])
  })

  it('deduplicates repeated paths and skips child symlinks without changing input structure', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vvtools-inputs-'))
    directories.push(root)
    const source = join(root, 'photo.JPG')
    writeFileSync(source, 'image')
    symlinkSync(root, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    expect(await collectImageInputs([source, source, root])).toEqual([
      { path: source, relativeDirectory: '' }
    ])
  })

  it('keeps the strict 500-image limit and rejects rather than returning a partial batch', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vvtools-inputs-'))
    directories.push(root)
    for (let index = 0; index < 500; index += 1) writeFileSync(join(root, `${index}.jpg`), 'image')
    const inputs = await collectImageInputs([root])
    expect(inputs).toHaveLength(500)
    expect(new Set(inputs.map((input) => input.path)).size).toBe(500)
    writeFileSync(join(root, 'extra.jpg'), 'image')
    await expect(collectImageInputs([root])).rejects.toThrow('单次最多添加 500 张图片')
  })

  it('yields to the event loop even while scanning a large folder with no supported images', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vvtools-inputs-'))
    directories.push(root)
    for (let index = 0; index < 512; index += 1)
      writeFileSync(join(root, `${index}.txt`), 'ignored')
    let finished = false
    const heartbeat = new Promise<void>((resolve) => setImmediate(resolve))
    const scanning = collectImageInputs([root]).then((inputs) => {
      finished = true
      return inputs
    })
    await heartbeat
    expect(finished).toBe(false)
    expect(await scanning).toEqual([])
  })

  it('reports missing input paths without hiding other filesystem errors', async () => {
    await expect(collectImageInputs(['relative.jpg'])).rejects.toThrow(
      '文件或目录不存在：relative.jpg'
    )
    const root = mkdtempSync(join(tmpdir(), 'vvtools-inputs-'))
    directories.push(root)
    const missing = join(root, 'missing.jpg')
    await expect(collectImageInputs([missing])).rejects.toThrow(`文件或目录不存在：${missing}`)
  })
})
