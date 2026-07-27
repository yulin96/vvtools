const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/
const RELEASE_TYPES = new Set(['patch', 'minor', 'major'])

function parseVersion(version: string): [number, number, number] {
  const match = version.match(SEMVER)
  if (!match) throw new Error(`无效版本号：${version}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

export function resolveReleaseVersion(currentVersion: string, input: string): string {
  const current = parseVersion(currentVersion)
  let next: [number, number, number]

  if (RELEASE_TYPES.has(input)) {
    if (input === 'major') next = [current[0] + 1, 0, 0]
    else if (input === 'minor') next = [current[0], current[1] + 1, 0]
    else next = [current[0], current[1], current[2] + 1]
  } else {
    next = parseVersion(input)
  }

  for (let index = 0; index < next.length; index += 1) {
    if (next[index] === current[index]) continue
    if (next[index] > current[index]) return next.join('.')
    break
  }
  throw new Error(`新版本 ${next.join('.')} 必须高于当前版本 ${currentVersion}`)
}
