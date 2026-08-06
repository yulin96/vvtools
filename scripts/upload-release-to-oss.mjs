import OSS from 'ali-oss'
import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

const required = [
  'OSS_ACCESS_KEY_ID',
  'OSS_ACCESS_KEY_SECRET',
  'OSS_BUCKET',
  'OSS_REGION',
  'OSS_RELEASE_PREFIX'
]
const missing = required.filter((name) => !process.env[name])
if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`)

const client = new OSS({
  accessKeyId: process.env.OSS_ACCESS_KEY_ID,
  accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
  bucket: process.env.OSS_BUCKET,
  region: process.env.OSS_REGION,
  endpoint: process.env.OSS_ENDPOINT || undefined,
  secure: true,
  timeout: 180_000,
  retryMax: 3
})

const root = join(process.cwd(), 'release-assets')
const entries = await readdir(root, { recursive: true, withFileTypes: true })
const files = entries
  .filter((entry) => entry.isFile())
  .map((entry) => join(entry.parentPath, entry.name))
const manifests = files.filter((file) => /(?:^|[/\\])(?:latest.*\.ya?ml|latest\.json)$/.test(file))
const packages = files.filter((file) => !manifests.includes(file))
const requiredManifests = [
  'mac-arm64/latest-mac.yml',
  'mac-x64/latest-mac.yml',
  'win-x64/latest.yml',
  'linux-x64/latest-linux.yml'
]
const prefix = process.env.OSS_RELEASE_PREFIX.replace(/^\/+|\/+$/g, '')
const mode = process.argv[2] ?? '--all'
const selectedFiles =
  mode === '--packages-only'
    ? packages
    : mode === '--manifests-only'
      ? manifests
      : mode === '--all'
        ? [...packages, ...manifests]
        : null

if (!selectedFiles) {
  throw new Error(
    'Usage: node scripts/upload-release-to-oss.mjs [--packages-only|--manifests-only]'
  )
}
if (selectedFiles.length === 0) {
  throw new Error(`No release files matched ${mode}`)
}
if (mode !== '--packages-only') {
  const manifestNames = new Set(manifests.map((file) => relative(root, file).replaceAll('\\', '/')))
  const missingManifests = requiredManifests.filter((name) => !manifestNames.has(name))
  if (missingManifests.length) {
    throw new Error(`Missing update manifests: ${missingManifests.join(', ')}`)
  }
}

for (const file of selectedFiles) {
  const name = relative(root, file).replaceAll('\\', '/')
  const objectName = prefix ? `${prefix}/${name}` : name
  const isManifest = manifests.includes(file)
  const headers = {
    'Cache-Control': isManifest ? 'public, max-age=300' : 'public, max-age=31536000, immutable'
  }

  if (isManifest) {
    await client.put(objectName, file, { headers })
  } else {
    await client.multipartUpload(objectName, file, {
      headers,
      parallel: 4,
      partSize: 8 * 1024 * 1024
    })
  }
  console.log(`Uploaded ${objectName}`)
}
