import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse, stringify } from 'yaml'

const MANIFESTS = {
  'mac-arm64': 'latest-mac.yml',
  'mac-x64': 'latest-mac.yml',
  'win-x64': 'latest.yml',
  'linux-x64': 'latest-linux.yml'
}

export async function prepareGithubReleaseAssets(
  source: string,
  output: string,
  version: string
): Promise<void> {
  const manifests = new Map()
  const assets = new Map()
  for (const [platform, manifestName] of Object.entries(MANIFESTS)) {
    const directory = join(source, platform)
    const manifest = parse(await readFile(join(directory, manifestName), 'utf8'))
    if (manifest?.version !== version || !Array.isArray(manifest.files) || !manifest.files.length) {
      throw new Error(`Invalid ${platform} update manifest for ${version}`)
    }
    for (const file of manifest.files) {
      if (typeof file.url !== 'string' || basename(file.url) !== file.url || !file.sha512) {
        throw new Error(`Invalid ${platform} update asset`)
      }
      // Fail before publishing if a manifest refers to a missing package.
      if (!(await stat(join(directory, file.url))).isFile())
        throw new Error(`Missing ${platform} package: ${file.url}`)
    }
    manifests.set(platform, manifest)
    for (const file of await readdir(directory, { withFileTypes: true })) {
      if (!file.isFile() || (platform.startsWith('mac-') && file.name === manifestName)) continue
      if (assets.has(file.name)) throw new Error(`Duplicate release asset: ${file.name}`)
      assets.set(file.name, join(directory, file.name))
    }
  }
  await mkdir(output, { recursive: true })
  for (const [name, sourcePath] of assets) await copyFile(sourcePath, join(output, name))
  const arm = manifests.get('mac-arm64')
  const intel = manifests.get('mac-x64')
  await writeFile(
    join(output, 'latest-mac.yml'),
    stringify({ ...arm, files: [...arm.files, ...intel.files] })
  )
  for (const architecture of ['arm64', 'x64']) {
    await copyFile(
      join(source, `mac-${architecture}`, 'latest-mac.yml'),
      join(output, `latest-mac-${architecture}.yml`)
    )
    await copyFile(
      join(source, `mac-${architecture}`, `vvtools-${version}-${architecture}.dmg`),
      join(output, `vvtools-latest-${architecture}.dmg`)
    )
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { version } = JSON.parse(await readFile('package.json', 'utf8'))
  await prepareGithubReleaseAssets(resolve('release-assets'), resolve('github-assets'), version)
}
