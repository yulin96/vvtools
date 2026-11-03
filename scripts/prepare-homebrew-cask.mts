import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function prepareHomebrewCask(
  templatePath: string,
  assetsDirectory: string,
  version: string,
  outputPath: string
): Promise<void> {
  const checksums: string[] = []
  for (const architecture of ['arm64', 'x64']) {
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(
      join(assetsDirectory, `vvtools-${version}-${architecture}.dmg`)
    )) {
      hash.update(chunk)
    }
    checksums.push(hash.digest('hex'))
  }
  const template = await readFile(templatePath, 'utf8')
  const cask = template.replace(
    /^ {2}version .*\n {2}sha256 arm: ".*",\n +intel: ".*"$/m,
    `  version "${version}"\n  sha256 arm: "${checksums[0]}",\n         intel: "${checksums[1]}"`
  )
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, cask)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { version } = JSON.parse(await readFile('package.json', 'utf8'))
  await prepareHomebrewCask(
    resolve('Casks/vvtools.rb'),
    resolve('github-assets'),
    version,
    resolve('.release/vvtools.rb')
  )
}
