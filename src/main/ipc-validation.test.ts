import { normalizeDesktopSettings } from '../shared/desktop-settings'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_FONT_OPTIONS, DEFAULT_IMAGE_OPTIONS } from '../shared/constants'
import {
  sanitizeRenameRequests,
  sanitizeSettings,
  validateCreateRequest,
  validateSourcePath
} from './ipc-validation'

const directories: string[] = []

function fixture(): { root: string; source: string } {
  const root = mkdtempSync(join(tmpdir(), 'vvtools-validation-'))
  directories.push(root)
  const source = join(root, 'photo.png')
  writeFileSync(source, 'image fixture')
  return { root, source }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('IPC payload validation', () => {
  it('preserves batch IDs and metadata while normalizing naming defaults', () => {
    const { root, source } = fixture()
    const request = {
      kind: 'image',
      sources: [{ path: source, relativeDirectory: 'album' }],
      batchItemIds: ['image-row'],
      outputMode: 'custom',
      outputDirectory: join(root, 'output'),
      outputSuffix: ' _small ',
      inputMetadata: [{ path: source, width: 16, height: 9, inputWidth: 160, inputHeight: 90 }],
      options: { ...DEFAULT_IMAGE_OPTIONS }
    }
    const result = validateCreateRequest(request)

    expect(result).toMatchObject({
      outputSuffix: '_small',
      outputNameTemplate: '{name}{suffix}',
      outputConflictPolicy: 'rename',
      batchItemIds: ['image-row'],
      inputMetadata: [{ path: source, width: 16, height: 9, inputWidth: 160, inputHeight: 90 }]
    })
    expect(result).not.toBe(request)
    expect(result.options).not.toBe(request.options)
  })

  it('rejects paths outside the allowed media and relative-directory contracts', () => {
    const { root, source } = fixture()
    const directory = join(root, 'directory.png')
    mkdirSync(directory)
    expect(() => validateSourcePath(directory, 'image')).toThrow('文件不存在或不可访问')
    expect(() => validateSourcePath(source, 'font')).toThrow('不支持的文件格式')
    expect(() =>
      validateCreateRequest({
        kind: 'image',
        sources: [{ path: source, relativeDirectory: '../escape' }],
        outputMode: 'source',
        outputDirectory: root,
        outputSuffix: '',
        options: DEFAULT_IMAGE_OPTIONS
      })
    ).toThrow('图片相对目录无效')
  })

  it('rejects duplicate batch IDs and metadata from another source', () => {
    const { root, source } = fixture()
    const request = {
      kind: 'image',
      sources: [{ path: source, relativeDirectory: '' }],
      outputMode: 'source',
      outputDirectory: root,
      outputSuffix: '',
      options: DEFAULT_IMAGE_OPTIONS
    }
    expect(() =>
      validateCreateRequest({
        ...request,
        sources: [request.sources[0], request.sources[0]],
        batchItemIds: ['row', 'row']
      })
    ).toThrow('批次任务标识不能重复')
    expect(() =>
      validateCreateRequest({
        ...request,
        inputMetadata: [{ path: join(root, 'other.png'), width: 16 }]
      })
    ).toThrow('媒体尺寸信息与源文件不匹配')
  })

  it('keeps incomplete custom subsets saveable but rejects them when creating tasks', () => {
    const { root } = fixture()
    const source = join(root, 'font.ttf')
    writeFileSync(source, 'font fixture')
    const options = {
      ...DEFAULT_FONT_OPTIONS,
      operation: 'subset' as const,
      subsetMode: 'custom' as const,
      subsetText: '',
      subsetTextFile: ''
    }

    expect(sanitizeSettings({ font: { lastOptions: options } })).toEqual({
      font: { lastOptions: options }
    })
    expect(() =>
      validateCreateRequest({
        kind: 'font',
        sources: [{ path: source, outputFormat: 'woff2' }],
        outputMode: 'source',
        outputDirectory: root,
        outputSuffix: '',
        options
      })
    ).toThrow('请输入需要保留的字符，或选择 TXT 文本文件')
  })

  it('keeps per-workspace suffixes independent and strips unknown settings', () => {
    const patch = {
      image: { outputSuffix: ' _image ', unknown: true },
      font: { outputSuffix: '_font' },
      unknown: true
    }
    expect(sanitizeSettings(patch)).toEqual({
      image: { outputSuffix: '_image' },
      font: { outputSuffix: '_font' }
    })
    expect(patch.image.outputSuffix).toBe(' _image ')
    expect(() => sanitizeSettings({ image: { outputSuffix: '../bad' } })).toThrow(
      '文件名后缀不能超过 50 个字符，且不能包含文件名非法字符'
    )
    expect(() => sanitizeSettings({ rename: { sequenceStep: 0 } })).toThrow(
      '批量重命名设置无效：sequenceStep'
    )
  })

  it('returns only allowed rename fields and rejects relative paths', () => {
    const { source } = fixture()
    expect(
      sanitizeRenameRequests([{ sourcePath: source, targetName: 'renamed.png', extra: true }])
    ).toEqual([{ sourcePath: source, targetName: 'renamed.png' }])
    expect(() =>
      sanitizeRenameRequests([{ sourcePath: 'relative.png', targetName: 'renamed.png' }])
    ).toThrow('批量重命名参数无效')
  })
  it('accepts complete quick-action snapshots but rejects overwrite, invalid paths, names, and duplicate actions', () => {
    const desktop = normalizeDesktopSettings({ contextMenuEnabled: true })
    expect(sanitizeSettings({ desktop: { notifyOnComplete: false } })).toEqual({
      desktop: { notifyOnComplete: false }
    })
    expect(sanitizeSettings({ desktop })).toEqual({ desktop })
    for (const changes of [
      { outputConflictPolicy: 'overwrite' },
      { outputMode: 'custom', outputDirectory: 'relative' },
      { name: 'a\0b' },
      { options: { ...desktop.actions[0].options, quality: 0 } }
    ]) {
      const changed = {
        ...desktop,
        actions: [{ ...desktop.actions[0], ...changes }, desktop.actions[1]]
      }
      expect(() => sanitizeSettings({ desktop: changed })).toThrow()
    }
    expect(() =>
      sanitizeSettings({ desktop: { actions: [desktop.actions[0], desktop.actions[0]] } })
    ).toThrow('快捷动作列表无效')
  })

  it('validates per-source image format overrides before output planning', () => {
    const { source } = fixture()
    const request = {
      kind: 'image',
      sources: [{ path: source, relativeDirectory: '', outputFormat: 'png' }],
      outputMode: 'source',
      outputDirectory: '',
      outputSuffix: '_share',
      options: { ...DEFAULT_IMAGE_OPTIONS, format: 'jpeg' }
    }
    expect(validateCreateRequest(request)).toMatchObject({ sources: [{ outputFormat: 'png' }] })
    expect(() =>
      validateCreateRequest({
        ...request,
        sources: [{ ...request.sources[0], outputFormat: 'original' }]
      })
    ).toThrow('图片输出格式无效')
  })
})
