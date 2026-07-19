import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectImageInputs } from '../src/main/media/image-inputs'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('image inputs', () => {
  it('expands folders and keeps relative directory structure', () => {
    const root = mkdtempSync(join(tmpdir(), 'vvtools-inputs-'))
    directories.push(root)
    const album = join(root, 'album')
    mkdirSync(join(album, 'day-1'), { recursive: true })
    writeFileSync(join(album, 'cover.jpg'), 'image')
    writeFileSync(join(album, 'day-1', 'photo.png'), 'image')
    writeFileSync(join(album, 'notes.txt'), 'ignored')

    expect(collectImageInputs([album])).toEqual([
      { path: join(album, 'cover.jpg'), relativeDirectory: 'album' },
      { path: join(album, 'day-1', 'photo.png'), relativeDirectory: join('album', 'day-1') }
    ])
  })
})
