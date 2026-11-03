import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parse } from 'yaml'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareHomebrewCask } from '../scripts/prepare-homebrew-cask.mts'

const roots: string[] = []
const version = '1.2.3'

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function fixture(): Promise<{
  root: string
  template: string
  assets: string
  output: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'vvtools-homebrew-'))
  roots.push(root)
  const template = join(root, 'Casks/vvtools.rb')
  const assets = join(root, 'github-assets')
  await mkdir(join(root, 'Casks'))
  await mkdir(assets)
  await writeFile(template, await readFile('Casks/vvtools.rb'))
  await writeFile(join(root, 'package.json'), JSON.stringify({ version }))
  for (const arch of ['arm64', 'x64']) {
    await writeFile(join(assets, `vvtools-${version}-${arch}.dmg`), `${version}:${arch}`)
  }
  return { root, template, assets, output: join(root, '.release/vvtools.rb') }
}

describe('Homebrew release cask', () => {
  it('runs the release CLI to pin the version and native DMG checksums while preserving installation steps', async () => {
    const { root, template, output } = await fixture()
    const original = await readFile(template, 'utf8')
    const result = spawnSync(process.execPath, [resolve('scripts/prepare-homebrew-cask.mts')], {
      cwd: root,
      encoding: 'utf8'
    })
    expect(result.status, result.stderr).toBe(0)
    const cask = await readFile(output, 'utf8')
    expect(cask).toContain('version "1.2.3"')
    for (const [arch, key] of [
      ['arm64', 'arm'],
      ['x64', 'intel']
    ]) {
      const digest = createHash('sha256').update(`${version}:${arch}`).digest('hex')
      expect(cask).toContain(`${key}: "${digest}"`)
    }
    expect(cask).toContain(
      'url "https://github.com/yulin96/vvtools/releases/download/v#{version}/vvtools-#{version}-#{arch}.dmg"'
    )
    expect(cask).not.toContain(':latest')
    expect(cask).not.toContain(':no_check')
    expect(cask.slice(cask.indexOf('  app '))).toBe(original.slice(original.indexOf('  app ')))
    expect(await readFile(template, 'utf8')).toBe(original)
  })

  it('does not generate a cask when a native DMG is missing', async () => {
    const { template, assets, output } = await fixture()
    await rm(join(assets, `vvtools-${version}-x64.dmg`))
    await expect(prepareHomebrewCask(template, assets, version, output)).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('generates the cask before publishing and commits it to main only after publishing succeeds', async () => {
    const workflow = parse(await readFile('.github/workflows/release.yml', 'utf8'))
    const steps = workflow.jobs.release.steps
    const prepare = steps.findIndex(
      (step: { name: string }) => step.name === 'Prepare release metadata'
    )
    const publish = steps.findIndex(
      (step: { name: string }) => step.name === 'Create release and upload files'
    )
    const checkout = steps.findIndex(
      (step: { name: string }) => step.name === 'Check out Homebrew tap branch'
    )
    const update = steps.findIndex((step: { name: string }) => step.name === 'Update Homebrew cask')
    expect(prepare).toBeGreaterThanOrEqual(0)
    expect(publish).toBeGreaterThan(prepare)
    expect(checkout).toBeGreaterThan(publish)
    expect(update).toBeGreaterThan(checkout)
    expect(steps[prepare].run).toContain('node scripts/prepare-homebrew-cask.mts')
    expect(steps[checkout].with).toMatchObject({ ref: 'main', path: 'homebrew-tap' })
    expect(steps[update]['working-directory']).toBe('homebrew-tap')
    expect(steps[update].run).toContain('cp ../.release/vvtools.rb Casks/vvtools.rb')
    expect(steps[update].run).toContain('git push origin HEAD:main')
    expect(steps[update]['continue-on-error']).toBeUndefined()
  })
})
