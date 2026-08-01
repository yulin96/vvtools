import type { FontInstance } from '../../shared/types'

export function sanitizeFontInstances(value: unknown): FontInstance[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error('字体实例信息无效')
  }
  if (value.length === 0) return undefined

  return value.map((item) => {
    if (!isRecord(item) || typeof item.name !== 'string' || !item.name.trim()) {
      throw new Error('字体实例信息无效')
    }
    if (!isRecord(item.axes) || Object.keys(item.axes).length > 32) {
      throw new Error('字体轴信息无效')
    }
    const axes: Record<string, number> = {}
    for (const [tag, axis] of Object.entries(item.axes)) {
      if (!/^[A-Za-z0-9]{4}$/u.test(tag) || typeof axis !== 'number' || !Number.isFinite(axis)) {
        throw new Error('字体轴信息无效')
      }
      axes[tag] = axis
    }
    return { name: item.name.trim().slice(0, 100), axes }
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
