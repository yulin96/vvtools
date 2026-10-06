import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'fs/promises'
import { spawnSync } from 'child_process'
import { createHash } from 'crypto'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { parse, stringify } from 'yaml'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareGithubReleaseAssets } from '../scripts/prepare-github-release.mts'

const roots: string[] = []
const version = '0.1.0'
const manifestNames = {
  'mac-arm64': 'latest-mac.yml',
  'mac-x64': 'latest-mac.yml',
  'win-x64': 'latest.yml',
  'linux-x64': 'latest-linux.yml'
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function fixture(): Promise<{ root: string; source: string; output: string }> {
  const root = await mkdtemp(join(tmpdir(), 'vvtools-github-release-'))
  roots.push(root)
  const source = join(root, 'release-assets')
  const output = join(root, 'github-assets')
  for (const [platform, manifestName] of Object.entries(manifestNames)) {
    const directory = join(source, platform)
    await mkdir(directory, { recursive: true })
    const names = platform.startsWith('mac-')
      ? [
          `vvtools-${version}-${platform.slice(4)}.zip`,
          `vvtools-${version}-${platform.slice(4)}.dmg`
        ]
      : [platform === 'win-x64' ? `vvtools-${version}-setup.exe` : `vvtools-${version}.AppImage`]
    const files: Array<{ url: string; sha512: string; size: number }> = []
    for (const url of names) {
      const bytes = Buffer.from(`${platform}:${url}`)
      await writeFile(join(directory, url), bytes)
      files.push({
        url,
        sha512: createHash('sha512').update(bytes).digest('base64'),
        size: bytes.length
      })
    }
    await writeFile(
      join(directory, manifestName),
      stringify({
        version,
        files,
        path: files[0].url,
        sha512: files[0].sha512,
        releaseNotes: '本版本更新内容'
      })
    )
  }
  return { root, source, output }
}

describe('GitHub release assets', () => {
  it('combines both macOS manifests and preserves native packages, checksums and stable DMG aliases', async () => {
    const { source, output } = await fixture()
    await prepareGithubReleaseAssets(source, output, version)
    const merged = parse(await readFile(join(output, 'latest-mac.yml'), 'utf8'))
    expect(merged).toMatchObject({
      version,
      path: 'vvtools-0.1.0-arm64.zip',
      releaseNotes: '本版本更新内容'
    })
    expect(merged.files.map((file: { url: string }) => file.url)).toEqual([
      'vvtools-0.1.0-arm64.zip',
      'vvtools-0.1.0-arm64.dmg',
      'vvtools-0.1.0-x64.zip',
      'vvtools-0.1.0-x64.dmg'
    ])
    for (const file of merged.files) {
      const bytes = await readFile(join(output, file.url))
      expect(createHash('sha512').update(bytes).digest('base64')).toBe(file.sha512)
      expect(bytes.length).toBe(file.size)
    }
    for (const arch of ['arm64', 'x64']) {
      expect(await readFile(join(output, `vvtools-latest-${arch}.dmg`))).toEqual(
        await readFile(join(source, `mac-${arch}`, `vvtools-0.1.0-${arch}.dmg`))
      )
      expect(await readFile(join(output, `latest-mac-${arch}.yml`))).toEqual(
        await readFile(join(source, `mac-${arch}`, 'latest-mac.yml'))
      )
    }
    expect((await readdir(output)).sort()).toEqual([
      'latest-linux.yml',
      'latest-mac-arm64.yml',
      'latest-mac-x64.yml',
      'latest-mac.yml',
      'latest.yml',
      'vvtools-0.1.0-arm64.dmg',
      'vvtools-0.1.0-arm64.zip',
      'vvtools-0.1.0-setup.exe',
      'vvtools-0.1.0-x64.dmg',
      'vvtools-0.1.0-x64.zip',
      'vvtools-0.1.0.AppImage',
      'vvtools-latest-arm64.dmg',
      'vvtools-latest-x64.dmg'
    ])
  })

  it('rejects different native build versions before creating release assets', async () => {
    const { source, output } = await fixture()
    const path = join(source, 'mac-x64', 'latest-mac.yml')
    const manifest = parse(await readFile(path, 'utf8'))
    manifest.version = '0.2.0'
    await writeFile(path, stringify(manifest))
    await expect(prepareGithubReleaseAssets(source, output, version)).rejects.toThrow(
      'Invalid mac-x64 update manifest for 0.1.0'
    )
    await expect(readdir(output)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects missing packages and duplicate asset names instead of publishing a broken release', async () => {
    const { source, output } = await fixture()
    const packagePath = join(source, 'win-x64', 'vvtools-0.1.0-setup.exe')
    const bytes = await readFile(packagePath)
    await rm(packagePath)
    await expect(prepareGithubReleaseAssets(source, output, version)).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(readdir(output)).rejects.toMatchObject({ code: 'ENOENT' })
    await writeFile(packagePath, bytes)
    for (const platform of ['mac-arm64', 'mac-x64'])
      await writeFile(join(source, platform, 'duplicate.blockmap'), 'fixture')
    await expect(prepareGithubReleaseAssets(source, output, version)).rejects.toThrow(
      'Duplicate release asset: duplicate.blockmap'
    )
  })

  it('runs the actual CLI with four packaged fixture folders without building or publishing', async () => {
    const { root, output } = await fixture()
    await writeFile(join(root, 'package.json'), JSON.stringify({ version }))
    const result = spawnSync(process.execPath, [resolve('scripts/prepare-github-release.mts')], {
      cwd: root,
      encoding: 'utf8'
    })
    expect(result.status, result.stderr).toBe(0)
    expect(parse(await readFile(join(output, 'latest-mac.yml'), 'utf8')).files).toHaveLength(4)
  })

  it('uses the public GitHub provider and keeps all native platform release jobs without OSS configuration', async () => {
    const builder = parse(await readFile('electron-builder.yml', 'utf8'))
    const development = parse(await readFile('dev-app-update.yml', 'utf8'))
    for (const config of [builder, development])
      expect(config.publish ?? config).toMatchObject({
        provider: 'github',
        owner: 'yulin96',
        repo: 'vvtools',
        private: false
      })
    const workflow = parse(await readFile('.github/workflows/release.yml', 'utf8'))
    expect(workflow.permissions).toEqual({ contents: 'write' })
    expect(
      workflow.jobs.build.strategy.matrix.include.map((item: { artifact: string }) => item.artifact)
    ).toEqual(['mac-arm64', 'mac-x64', 'win-x64', 'linux-x64'])
    const steps = [...workflow.jobs.build.steps, ...workflow.jobs.release.steps]
    expect(
      steps
        .flatMap((step: { env?: Record<string, string> }) => Object.keys(step.env ?? {}))
        .filter((name: string) => name.startsWith('OSS_') || name === 'VVTOOLS_UPDATE_BASE_URL')
    ).toEqual([])
    expect(
      workflow.jobs.release.steps.find(
        (step: { name: string }) => step.name === 'Create release and upload files'
      ).env
    ).toEqual({ GH_TOKEN: '${{ github.token }}' })
  })
})
