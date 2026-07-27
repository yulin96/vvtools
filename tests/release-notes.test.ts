import { describe, expect, it } from 'vitest'
import {
  archiveUnreleasedReleaseNotes,
  extractVersionReleaseNotes
} from '../src/shared/release-notes.mjs'

const changelog = `# 更新日志

## 未发布

- 尚未发布

## v0.2.0

- 新版本

## v0.1.0

- 旧版本
`

describe('release notes', () => {
  it('extracts only the requested version', () => {
    expect(extractVersionReleaseNotes(changelog, 'v0.2.0')).toBe('- 新版本')
    expect(extractVersionReleaseNotes(changelog, '0.1.0')).toBe('- 旧版本')
  })

  it('distinguishes an empty section from a missing version', () => {
    expect(extractVersionReleaseNotes('## v0.2.0\n\n## v0.1.0\n\n- 旧版本', '0.2.0')).toBe('')
    expect(extractVersionReleaseNotes(changelog, '0.3.0')).toBeUndefined()
  })

  it('archives the unreleased section under the target version', () => {
    const result = archiveUnreleasedReleaseNotes(changelog, '0.3.0')

    expect(result).toContain('## 未发布\n\n## v0.3.0\n\n- 尚未发布')
    expect(extractVersionReleaseNotes(result, '0.3.0')).toBe('- 尚未发布')
    expect(extractVersionReleaseNotes(result, '0.2.0')).toBe('- 新版本')
  })

  it('requires one top-level unreleased section', () => {
    expect(() => archiveUnreleasedReleaseNotes('## v0.2.0\n\n- 新版本\n', '0.3.0')).toThrow(
      '更新日志顶部必须且只能存在一个“## 未发布”章节'
    )
  })
})
