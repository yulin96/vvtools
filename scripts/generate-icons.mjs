import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const source = process.argv[2] || 'build/logo-source.png'
const iconSet = await mkdtemp(join(tmpdir(), 'vvtools-iconset-'))
const canvasSize = 1024
const logoTargetWidth = 680
const windowsBadgeSize = 860
const backgroundColor = '#15172B'

try {
  if (resolve(source) !== resolve('build/logo-source.png')) {
    await sharp(source)
      .resize(canvasSize, canvasSize, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toFile('build/logo-source.png')
  }

  const { data: logo, info: logoInfo } = await sharp('build/logo-source.png')
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 5 })
    .resize({ width: logoTargetWidth })
    .png()
    .toBuffer({ resolveWithObject: true })
  const logoLeft = Math.round((canvasSize - logoInfo.width) / 2)
  const logoTop = Math.round((canvasSize - logoInfo.height) / 2) - 12
  const background = Buffer.from(`
    <svg width="${canvasSize}" height="${canvasSize}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${canvasSize}" height="${canvasSize}" rx="224" fill="${backgroundColor}" />
    </svg>
  `)
  const macIcon = await sharp({
    create: {
      width: canvasSize,
      height: canvasSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([{ input: background }, { input: logo, left: logoLeft, top: logoTop }])
    .png()
    .toBuffer()
  const windowsBadge = await sharp(macIcon)
    .resize(windowsBadgeSize, windowsBadgeSize)
    .png()
    .toBuffer()
  const windowsInset = Math.round((canvasSize - windowsBadgeSize) / 2)
  const windowsIcon = await sharp({
    create: {
      width: canvasSize,
      height: canvasSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([{ input: windowsBadge, left: windowsInset, top: windowsInset }])
    .png()
    .toBuffer()

  await writeFile('build/icon-source.png', macIcon)
  await writeFile('build/icon-windows.png', windowsIcon)
  await sharp(macIcon).resize(512, 512).png().toFile('build/icon.png')
  await sharp(windowsIcon).resize(512, 512).png().toFile('resources/icon.png')

  const icoSizes = [16, 24, 32, 48, 64, 128, 256]
  const icoPaths = await Promise.all(
    icoSizes.map(async (size) => {
      const path = join(iconSet, `ico-${size}.png`)
      await sharp(windowsIcon).resize(size, size).png().toFile(path)
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
        sharp(macIcon)
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
