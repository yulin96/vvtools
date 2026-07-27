const VERSION_HEADING = /^## v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\s*$/gm
const SECTION_HEADING = /^## (.+?)\s*$/gm

export function extractVersionReleaseNotes(
  changelog: string,
  requestedVersion: string
): string | undefined {
  const version = requestedVersion.replace(/^v/, '')
  const headings = [...changelog.matchAll(VERSION_HEADING)]
  const headingIndex = headings.findIndex((heading) => heading[1] === version)
  if (headingIndex === -1) return undefined

  const heading = headings[headingIndex]
  const nextHeading = headings[headingIndex + 1]
  const contentStart = (heading.index ?? 0) + heading[0].length
  return changelog.slice(contentStart, nextHeading?.index).trim()
}

export function archiveUnreleasedReleaseNotes(changelog: string, requestedVersion: string): string {
  const version = requestedVersion.replace(/^v/, '')
  if (extractVersionReleaseNotes(changelog, version) !== undefined) {
    throw new Error(`更新日志中已存在 v${version}`)
  }

  const headings = [...changelog.matchAll(SECTION_HEADING)]
  const unreleasedHeadings = headings.filter((heading) => heading[1] === '未发布')
  if (unreleasedHeadings.length !== 1 || headings[0] !== unreleasedHeadings[0]) {
    throw new Error('更新日志顶部必须且只能存在一个“## 未发布”章节')
  }

  const heading = unreleasedHeadings[0]
  const nextHeading = headings[1]
  const headingStart = heading.index ?? 0
  const contentStart = headingStart + heading[0].length
  const unreleasedContent = changelog.slice(contentStart, nextHeading?.index).trim()
  const history = nextHeading ? changelog.slice(nextHeading.index).trim() : ''
  const sections = [
    changelog.slice(0, headingStart).trimEnd(),
    '',
    '## 未发布',
    '',
    `## v${version}`
  ]

  if (unreleasedContent) sections.push('', unreleasedContent)
  if (history) sections.push('', history)
  return `${sections.join('\n')}\n`
}
