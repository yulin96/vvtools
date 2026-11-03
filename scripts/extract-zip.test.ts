import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { crc32, deflateRawSync } from 'node:zlib'
import { expect, it } from 'vitest'

it('extracts a ZIP larger than the stream buffer without exiting with unsettled await', () => {
  const root = mkdtempSync(join(tmpdir(), 'vvtools-extract-'))
  try {
    const payload = randomBytes(256 * 1024)
    const compressed = deflateRawSync(payload)
    const name = Buffer.from('runtime/bin/tool.bin')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc32(payload), 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(payload.length, 22)
    local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    local.copy(central, 6, 4, 28)
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(1, 8)
    end.writeUInt16LE(1, 10)
    end.writeUInt32LE(central.length + name.length, 12)
    end.writeUInt32LE(local.length + name.length + compressed.length, 16)
    const archive = join(root, 'runtime.zip')
    const output = join(root, 'output')
    writeFileSync(archive, Buffer.concat([local, name, compressed, central, name, end]))

    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import extract from 'extract-zip'; await extract(process.argv[1], { dir: process.argv[2] })",
        archive,
        output
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 10_000 }
    )
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    expect(readFileSync(join(output, 'runtime/bin/tool.bin'))).toEqual(payload)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
