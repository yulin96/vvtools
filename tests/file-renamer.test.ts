import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  inspectRenameFiles,
  inspectRenamePlan,
  renameFiles
} from '../src/main/services/file-renamer'

const directories: string[] = []

function workspace(): string {
  const directory = mkdtempSync(join(tmpdir(), 'vvtools-rename-'))
  directories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('file renamer', () => {
  it('inspects ordinary files and reports unsupported paths separately', () => {
    const root = workspace()
    const file = join(root, 'photo.jpg')
    const folder = join(root, 'folder')
    writeFileSync(file, 'image')
    mkdirSync(folder)

    const result = inspectRenameFiles([file, folder, join(root, 'missing.txt')])

    expect(result.files).toHaveLength(1)
    expect(result.files[0]).toMatchObject({
      path: file,
      name: 'photo.jpg',
      stem: 'photo',
      extension: '.jpg',
      size: 5
    })
    expect(result.rejected).toHaveLength(2)
  })

  it('renames a cycle through temporary paths without overwriting content', () => {
    const root = workspace()
    const first = join(root, 'first.txt')
    const second = join(root, 'second.txt')
    writeFileSync(first, 'FIRST')
    writeFileSync(second, 'SECOND')

    const result = renameFiles([
      { sourcePath: first, targetName: 'second.txt' },
      { sourcePath: second, targetName: 'first.txt' }
    ])

    expect(result.every((item) => item.renamed)).toBe(true)
    expect(readFileSync(first, 'utf8')).toBe('SECOND')
    expect(readFileSync(second, 'utf8')).toBe('FIRST')
  })

  it('rejects an existing external target before changing any file', () => {
    const root = workspace()
    const source = join(root, 'source.txt')
    const existing = join(root, 'existing.txt')
    writeFileSync(source, 'SOURCE')
    writeFileSync(existing, 'EXISTING')

    expect(() => renameFiles([{ sourcePath: source, targetName: 'existing.txt' }])).toThrow(
      '目标文件已存在'
    )
    expect(readFileSync(source, 'utf8')).toBe('SOURCE')
    expect(readFileSync(existing, 'utf8')).toBe('EXISTING')
  })

  it('previews duplicate targets and files blocked by active media tasks', () => {
    const root = workspace()
    const first = join(root, 'first.txt')
    const second = join(root, 'second.txt')
    writeFileSync(first, 'FIRST')
    writeFileSync(second, 'SECOND')

    const duplicate = inspectRenamePlan([
      { sourcePath: first, targetName: 'same.txt' },
      { sourcePath: second, targetName: 'same.txt' }
    ])
    const blocked = inspectRenamePlan([{ sourcePath: first, targetName: 'renamed.txt' }], {
      blockedPaths: new Set([first])
    })
    const blockedTargetPath = join(root, 'processing.txt')
    const blockedTarget = inspectRenamePlan([{ sourcePath: first, targetName: 'processing.txt' }], {
      blockedPaths: new Set([blockedTargetPath])
    })

    expect(duplicate.every((item) => item.error === '新名称与批次中的其他文件重复')).toBe(true)
    expect(blocked[0]).toMatchObject({ valid: false, error: '文件正在被处理，暂时不能重命名' })
    expect(blockedTarget[0]).toMatchObject({
      valid: false,
      error: '目标名称正在被处理，暂时不能使用'
    })
    expect(() =>
      renameFiles([{ sourcePath: first, targetName: 'processing.txt' }], {
        blockedPaths: new Set([blockedTargetPath])
      })
    ).toThrow('目标名称正在被处理')
  })

  it('preserves file extensions and rejects portable-invalid names', () => {
    const root = workspace()
    const source = join(root, 'source.txt')
    writeFileSync(source, 'SOURCE')

    expect(() => renameFiles([{ sourcePath: source, targetName: 'source.jpg' }])).toThrow(
      '不允许修改文件扩展名'
    )
    expect(() => renameFiles([{ sourcePath: source, targetName: 'bad:name.txt' }])).toThrow(
      '系统不支持'
    )
  })
})
