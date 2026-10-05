import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const sources = [
  { source: process.argv[2] || 'build/logo-source.png', suffix: '' },
  { source: process.argv[3] || 'build/logo-source-dark.png', suffix: '-dark' }
]
const markSource = process.argv[4] || 'build/logo-mark-source.png'
const canvasSize = 1024
const macBadgeSize = 824
const windowsBadgeSize = 896
const transparent = { r: 0, g: 0, b: 0, alpha: 0 }
const iconSet = await mkdtemp(join(tmpdir(), 'vvtools-iconset-'))

try {
  await mkdir('build', { recursive: true })
  await mkdir('resources', { recursive: true })
  const mask = Buffer.from(`
    <svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg">
      <rect width="1024" height="1024" rx="224" fill="white" />
    </svg>
  `)
  for (const { source, suffix } of sources) {
    const metadata = await sharp(source).metadata()
    if (metadata.width !== metadata.height || metadata.width < canvasSize) {
      throw new Error('图标源文件必须是至少 1024 × 1024 的完整正方形图像')
    }
    const master = await sharp(source)
      .resize(canvasSize, canvasSize)
      .toColourspace('srgb')
      .png()
      .toBuffer()
    if (resolve(source) !== resolve(`build/logo-source${suffix}.png`)) {
      await writeFile(`build/logo-source${suffix}.png`, master)
    }
    const badge = await sharp(master)
      .ensureAlpha()
      .composite([{ input: mask, blend: 'dest-in' }])
      .png()
      .toBuffer()
    const macInset = (canvasSize - macBadgeSize) / 2
    const macIcon = await sharp(badge)
      .resize(macBadgeSize, macBadgeSize)
      .extend({
        top: macInset,
        bottom: macInset,
        left: macInset,
        right: macInset,
        background: transparent
      })
      .png()
      .toBuffer()
    const windowsInset = (canvasSize - windowsBadgeSize) / 2
    const windowsIcon = await sharp(badge)
      .resize(windowsBadgeSize, windowsBadgeSize)
      .extend({
        top: windowsInset,
        bottom: windowsInset,
        left: windowsInset,
        right: windowsInset,
        background: transparent
      })
      .png()
      .toBuffer()

    await writeFile(`build/icon-source${suffix}.png`, macIcon)
    await writeFile(`build/icon-windows${suffix}.png`, windowsIcon)
    await sharp(badge).resize(512, 512).png().toFile(`build/icon${suffix}.png`)
    await sharp(badge).resize(512, 512).png().toFile(`resources/icon${suffix}.png`)
    await writeFile(`resources/icon-mac${suffix}.png`, macIcon)

    const icoSizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
    const icoPaths = await Promise.all(
      icoSizes.map(async (size) => {
        const path = join(iconSet, `ico${suffix}-${size}.png`)
        const badgeSize = 2 * Math.round((size * windowsBadgeSize) / canvasSize / 2)
        const inset = (size - badgeSize) / 2
        await sharp(badge)
          .resize(badgeSize, badgeSize)
          .extend({ top: inset, bottom: inset, left: inset, right: inset, background: transparent })
          .png()
          .toFile(path)
        return path
      })
    )
    await writeFile(`build/icon${suffix}.ico`, await pngToIco(icoPaths))

    if (process.platform === 'darwin') {
      const macIconSet = join(iconSet, `VVTools${suffix}.iconset`)
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
      const result = spawnSync(
        'iconutil',
        ['-c', 'icns', macIconSet, '-o', `build/icon${suffix}.icns`],
        {
          stdio: 'inherit'
        }
      )
      if (result.error) throw result.error
      if (result.status !== 0) throw new Error('iconutil 生成 ICNS 失败')
    }
  }
  const markMetadata = await sharp(markSource).metadata()
  if (markMetadata.width !== markMetadata.height || markMetadata.width < canvasSize) {
    throw new Error('内容图标源文件必须是至少 1024 × 1024 的正方形图像')
  }
  const markStats = await sharp(markSource).stats()
  if (!markMetadata.hasAlpha || markStats.channels.at(-1).min !== 0) {
    throw new Error('内容图标源文件必须包含透明背景')
  }
  const markMaster = await sharp(markSource)
    .resize(canvasSize, canvasSize)
    .toColourspace('srgb')
    .png()
    .toBuffer()
  if (resolve(markSource) !== resolve('build/logo-mark-source.png')) {
    await writeFile('build/logo-mark-source.png', markMaster)
  }
  await sharp(markMaster)
    .trim()
    .resize(256, 256, { fit: 'contain', background: transparent })
    .png()
    .toFile('resources/logo.png')
} finally {
  await rm(iconSet, { recursive: true, force: true })
}

console.log('Generated VVTools application icons')
