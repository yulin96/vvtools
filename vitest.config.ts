import { defineConfig } from 'vitest/config'
import { mkdir, readFile, rm, symlink, writeFile } from 'fs/promises'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, relative, resolve } from 'path'
import ts from 'typescript'

export default defineConfig(() => {
  const root = mkdtempSync(join(tmpdir(), 'vvtools-test-workers-'))
  const copied = new Map<string, Promise<string>>()
  let linked: Promise<void> | undefined
  async function stageWorker(path: string): Promise<string> {
    const existing = copied.get(path)
    if (existing) return existing
    const pending = (async (): Promise<string> => {
      linked ??= symlink(
        resolve('node_modules'),
        join(root, 'node_modules'),
        process.platform === 'win32' ? 'junction' : 'dir'
      )
      await linked
      const target = join(root, relative(process.cwd(), path)).replace(/\.ts$/u, '.mjs')
      let code = ts.transpileModule(await readFile(path, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
      }).outputText
      for (const match of code.matchAll(/\bfrom\s+(['"])(\.[^'"]+)\1/gu)) {
        const dependency = resolve(dirname(path), `${match[2]}.ts`)
        await stageWorker(dependency)
        code = code.replace(match[0], `from '${match[2]}.mjs'`)
      }
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, code)
      return target
    })()
    copied.set(path, pending)
    return pending
  }
  return {
    plugins: [
      {
        name: 'test-node-worker-modules',
        resolveId(source, importer) {
          if (source.endsWith('?modulePath') && importer) return resolve(dirname(importer), source)
          return null
        },
        async load(id) {
          if (!id.endsWith('?modulePath')) return null
          const path = id.slice(0, -'?modulePath'.length)
          return `export default ${JSON.stringify(await stageWorker(path.endsWith('.ts') ? path : path + '.ts'))}`
        },
        async closeBundle() {
          await rm(root, { recursive: true, force: true })
        }
      }
    ]
  }
})
