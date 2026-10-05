import { describe, expect, it } from 'vitest'
import { normalizeDesktopSettings } from './desktop-settings'

describe('desktop setting snapshots', () => {
  it('adds independent defaults without enabling system right-click automatically', () => {
    const first = normalizeDesktopSettings(undefined)
    expect(first).toMatchObject({
      contextMenuEnabled: false,
      notifyOnComplete: true,
      revealOnComplete: false
    })
    expect(
      first.actions.map(({ id, outputMode, outputSuffix, outputConflictPolicy, options }) => ({
        id,
        outputMode,
        outputSuffix,
        outputConflictPolicy,
        format: options.format,
        quality: options.quality,
        width: options.width,
        resizeMode: options.resizeMode
      }))
    ).toEqual([
      {
        id: 'image-share',
        outputMode: 'source',
        outputSuffix: '_share',
        outputConflictPolicy: 'rename',
        format: 'jpeg',
        quality: 80,
        width: 300,
        resizeMode: 'width'
      },
      {
        id: 'image-web',
        outputMode: 'source',
        outputSuffix: '_web',
        outputConflictPolicy: 'rename',
        format: 'webp',
        quality: 90,
        width: 1920,
        resizeMode: 'source'
      }
    ])
    first.actions[0].options.width = 999
    expect(normalizeDesktopSettings(undefined).actions[0].options.width).toBe(300)
  })
  it('keeps saved order and restores invalid fields and missing actions', () => {
    const settings = normalizeDesktopSettings({
      trayMode: 'always',
      actions: [
        {
          id: 'image-web',
          name: 'Custom',
          enabled: false,
          options: { format: 'invalid', quality: 0, width: 640 },
          outputConflictPolicy: 'overwrite'
        },
        { id: 'image-web', name: 'Duplicate' },
        { id: 'unknown' }
      ]
    })
    expect(settings.actions.map((action) => action.id)).toEqual(['image-web', 'image-share'])
    expect(settings.actions[0]).toMatchObject({
      name: 'Custom',
      enabled: false,
      options: { format: 'webp', quality: 90, width: 640 },
      outputConflictPolicy: 'rename'
    })
    expect(settings).not.toHaveProperty('trayMode')
  })
  it('preserves configured fields during unrelated partial updates', () => {
    const previous = normalizeDesktopSettings(undefined)
    previous.actions[0].outputMode = 'custom'
    previous.actions[0].outputDirectory = '/tmp/custom'
    previous.actions[0].outputConflictPolicy = 'skip'
    const next = normalizeDesktopSettings({ notifyOnComplete: false }, previous)
    expect(next.actions).toEqual(previous.actions)
    expect(next.notifyOnComplete).toBe(false)
    expect(next.actions).not.toBe(previous.actions)
    expect(
      normalizeDesktopSettings({ actions: [{ id: 'image-share', name: 'a\0b' }] }).actions[0].name
    ).toBe('压缩为分享图')
  })
})
