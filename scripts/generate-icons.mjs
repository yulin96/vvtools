import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'
import { writeFile } from 'node:fs/promises'

const source = process.argv[2] || 'build/icon-source.png'
const iconSet = await mkdtemp(join(tmpdir(), 'vvtools-iconset-'))

try {
  if (resolve(source) !== resolve('build/icon-source.png')) {
    await sharp(source).resize(1024, 1024).png().toFile('build/icon-source.png')
  }
  await sharp(source).resize(512, 512).png().toFile('build/icon.png')
  await sharp(source).resize(512, 512).png().toFile('resources/icon.png')

  const icoSizes = [16, 24, 32, 48, 64, 128, 256]
  const icoPaths = await Promise.all(
    icoSizes.map(async (size) => {
      const path = join(iconSet, `ico-${size}.png`)
      await sharp(source).resize(size, size).png().toFile(path)
      return path
    })
  )
  await writeFile('build/icon.ico', await pngToIco(icoPaths))

  if (process.platform === 'darwin') {
    const macIconSet = join(iconSet, 'VVTools.iconset')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(macIconSet)
    const macSizes = [
      ['icon_16x16.png', 16],
      ['icon_16x16@2x.png', 32],
      ['icon_32x32.png', 32],
      ['icon_32x32@2x.png', 64],
      ['icon_128x128.png', 128],
      ['icon_128x128@2x.png', 256],
      ['icon_256x256.png', 256],
      ['icon_256x256@2x.png', 512],
      ['icon_512x512.png', 512],
      ['icon_512x512@2x.png', 1024]
    ]
    await Promise.all(
      macSizes.map(([name, size]) =>
        sharp(source)
          .resize(Number(size), Number(size))
          .png()
          .toFile(join(macIconSet, String(name)))
      )
    )
    const result = spawnSync('iconutil', ['-c', 'icns', macIconSet, '-o', 'build/icon.icns'], {
      stdio: 'inherit'
    })
    if (result.status !== 0) throw new Error('iconutil 生成 ICNS 失败')
  }
} finally {
  await rm(iconSet, { recursive: true, force: true })
}

console.log('Generated VVTools application icons')
