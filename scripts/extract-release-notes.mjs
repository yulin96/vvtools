import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { extractVersionReleaseNotes } from '../src/shared/release-notes.mts'

const options = new Map()
for (let index = 2; index < process.argv.length; index += 2) {
  options.set(process.argv[index], process.argv[index + 1])
}

const root = process.cwd()
const sourcePath = resolve(root, options.get('--source') ?? 'release-notes.md')
const outputPath = options.get('--output')
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const version = options.get('--version') ?? packageJson.version
const changelog = await readFile(sourcePath, 'utf8')
const releaseNotes = extractVersionReleaseNotes(changelog, version)

if (releaseNotes === undefined) {
  throw new Error(`release-notes.md 中缺少 v${version.replace(/^v/, '')} 版本`)
}

if (outputPath) {
  const target = resolve(root, outputPath)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, `${releaseNotes}\n`, 'utf8')
} else {
  process.stdout.write(`${releaseNotes}\n`)
}
