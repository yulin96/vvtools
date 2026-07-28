import { execFileSync, spawnSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { archiveUnreleasedReleaseNotes } from '../src/shared/release-notes.mts'
import { resolveReleaseVersion } from '../src/shared/release-version.mts'

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function run(command: string, args: string[]): void {
  execFileSync(command, args, { stdio: 'inherit' })
}

function runPnpm(args: string[]): void {
  if (process.platform === 'win32') {
    execFileSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'pnpm', ...args], {
      stdio: 'inherit'
    })
    return
  }
  run('pnpm', args)
}

function tagExists(tag: string): boolean {
  return spawnSync('git', ['rev-parse', '--quiet', '--verify', `refs/tags/${tag}`]).status === 0
}

async function main(): Promise<void> {
  const input = process.argv[2]
  if (!input || process.argv.length > 3) {
    throw new Error('用法：pnpm release <patch|minor|major|X.Y.Z>')
  }

  const root = process.cwd()
  const packagePath = resolve(root, 'package.json')
  const releaseNotesPath = resolve(root, 'release-notes.md')
  const originalPackageJson = await readFile(packagePath, 'utf8')
  const originalReleaseNotes = await readFile(releaseNotesPath, 'utf8')
  const packageJson = JSON.parse(originalPackageJson)
  const currentVersion = String(packageJson.version)
  const nextVersion = resolveReleaseVersion(currentVersion, input)
  const tag = `v${nextVersion}`
  let filesUpdated = false
  let commitCreated = false
  let tagCreated = false

  try {
    if (resolve(git(['rev-parse', '--show-toplevel'])) !== resolve(root)) {
      throw new Error('请在仓库根目录执行发布命令')
    }
    if (git(['status', '--porcelain'])) throw new Error('工作区必须保持干净')
    if (git(['branch', '--show-current']) !== 'main') throw new Error('只能从 main 分支发布')

    run('git', ['fetch', 'origin', '--tags'])
    if (git(['rev-parse', 'HEAD']) !== git(['rev-parse', 'origin/main'])) {
      throw new Error('本地 main 必须与 origin/main 完全一致')
    }
    if (tagExists(tag)) throw new Error(`标签 ${tag} 已存在`)

    packageJson.version = nextVersion
    const nextReleaseNotes = archiveUnreleasedReleaseNotes(originalReleaseNotes, nextVersion)
    await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8')
    await writeFile(releaseNotesPath, nextReleaseNotes, 'utf8')
    filesUpdated = true

    runPnpm(['release-notes:prepare'])
    runPnpm(['typecheck'])
    runPnpm(['lint'])
    runPnpm(['test'])
    run('git', ['diff', '--check'])

    run('git', ['add', '--', 'package.json', 'release-notes.md'])
    run('git', ['commit', '-m', nextVersion])
    commitCreated = true
    run('git', ['tag', '-a', tag, '-m', tag])
    tagCreated = true
    run('git', ['push', '--atomic', 'origin', 'main', tag])

    console.log(`已发布 ${tag}，GitHub Actions 将自动构建并创建 Release。`)
  } catch (error) {
    if (filesUpdated && !commitCreated) {
      await writeFile(packagePath, originalPackageJson, 'utf8')
      await writeFile(releaseNotesPath, originalReleaseNotes, 'utf8')
      spawnSync('git', ['restore', '--staged', '--', 'package.json', 'release-notes.md'])
    }
    if (commitCreated) {
      const nextStep = tagCreated
        ? `git push --atomic origin main ${tag}`
        : `git tag -a ${tag} -m ${tag}`
      console.error(`本地提交已创建；修复问题后可执行：${nextStep}`)
    }
    throw error
  }
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
