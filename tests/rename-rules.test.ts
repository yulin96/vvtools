import { describe, expect, it } from 'vitest'
import { buildRenamePreview, sortRenameFiles } from '../src/renderer/src/lib/rename-rules'
import { DEFAULT_RENAME_SETTINGS } from '../src/shared/constants'
import type { RenameFileInfo, RenameSettings } from '../src/shared/types'

function file(name: string, modifiedAt: string, size = 1): RenameFileInfo {
  const extension = name.match(/\.[^.]+$/u)?.[0] ?? ''
  return {
    path: `/files/${name}`,
    name,
    stem: extension ? name.slice(0, -extension.length) : name,
    extension,
    size,
    createdAt: '2026-01-02T03:04:05.000Z',
    modifiedAt
  }
}

function settings(patch: Partial<RenameSettings>): RenameSettings {
  return { ...DEFAULT_RENAME_SETTINGS, ...patch }
}

describe('rename rules', () => {
  it('combines replacement, case, prefix, suffix and sequence rules', () => {
    const [row] = buildRenamePreview(
      [file('holiday photo.JPG', '2026-01-01T00:00:00.000Z')],
      settings({
        mode: 'custom',
        prefix: 'IMG_',
        suffix: '_EDIT',
        findText: ' ',
        replaceText: '-',
        caseMode: 'upper',
        sequenceStart: 5,
        sequencePadding: 3
      }),
      'darwin'
    )

    expect(row.targetName).toBe('IMG_HOLIDAY-PHOTO_EDIT_005.JPG')
    expect(row.error).toBeUndefined()
  })

  it('uses the visible sort order as the sequence order', () => {
    const rows = buildRenamePreview(
      [
        file('older.jpg', '2026-01-01T00:00:00.000Z'),
        file('newer.jpg', '2026-02-01T00:00:00.000Z')
      ],
      settings({
        mode: 'custom',
        baseMode: 'custom',
        customName: 'photo',
        sortField: 'modifiedAt',
        sortDirection: 'desc'
      }),
      'darwin'
    )

    expect(rows.map((row) => [row.file.name, row.targetName])).toEqual([
      ['newer.jpg', 'photo_001.jpg'],
      ['older.jpg', 'photo_002.jpg']
    ])
  })

  it('sorts naturally and keeps equal values stable', () => {
    const files = [
      file('photo10.jpg', '2026-01-01T00:00:00.000Z', 2),
      file('photo2.jpg', '2026-01-01T00:00:00.000Z', 2),
      file('photo1.jpg', '2026-01-01T00:00:00.000Z', 1)
    ]

    expect(
      sortRenameFiles(files, { sortField: 'name', sortDirection: 'asc' }).map((item) => item.name)
    ).toEqual(['photo1.jpg', 'photo2.jpg', 'photo10.jpg'])
    expect(
      sortRenameFiles(files, { sortField: 'size', sortDirection: 'desc' }).map((item) => item.name)
    ).toEqual(['photo10.jpg', 'photo2.jpg', 'photo1.jpg'])
  })

  it('flags case-insensitive duplicates on macOS and Windows', () => {
    const rows = buildRenamePreview(
      [file('one.jpg', '2026-01-01T00:00:00.000Z'), file('two.jpg', '2026-01-01T00:00:00.000Z')],
      settings({ mode: 'custom', baseMode: 'custom', customName: 'same', sequenceEnabled: false }),
      'darwin'
    )

    expect(rows.every((row) => row.error === '新名称与批次中的其他文件重复')).toBe(true)
  })

  it('uses plain visible-order numbers in sequence mode', () => {
    const rows = buildRenamePreview(
      [
        file('second.png', '2026-01-02T00:00:00.000Z'),
        file('first.jpg', '2026-01-01T00:00:00.000Z')
      ],
      settings({ mode: 'sequence', sortField: 'modifiedAt', sortDirection: 'asc' }),
      'darwin'
    )

    expect(rows.map((row) => [row.file.name, row.targetName])).toEqual([
      ['first.jpg', '1.jpg'],
      ['second.png', '2.png']
    ])
  })
})
