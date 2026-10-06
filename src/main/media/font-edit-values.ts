import type { FontEditValues } from '../../shared/types'

export function validateFontEditValues(value: unknown): FontEditValues {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('字体编辑参数无效')
  }
  const input = value as Record<string, unknown>
  const number = (key: keyof FontEditValues, minimum: number, maximum: number): number => {
    const current = input[key]
    if (
      typeof current !== 'number' ||
      !Number.isFinite(current) ||
      current < minimum ||
      current > maximum
    ) {
      throw new Error(`字体编辑参数无效：${key}`)
    }
    return current
  }
  const unitsPerEm = number('unitsPerEm', 64, 16_384)
  const result: FontEditValues = {
    unitsPerEm,
    offsetX: number('offsetX', -unitsPerEm * 4, unitsPerEm * 4),
    offsetY: number('offsetY', -unitsPerEm * 4, unitsPerEm * 4),
    scaleX: number('scaleX', 0.1, 4),
    scaleY: number('scaleY', 0.1, 4),
    skewX: number('skewX', -45, 45),
    advanceWidthDelta: number('advanceWidthDelta', -unitsPerEm, unitsPerEm * 4),
    ascent: number('ascent', 0, unitsPerEm * 4),
    descent: number('descent', -unitsPerEm * 4, 0),
    lineGap: number('lineGap', 0, unitsPerEm * 4),
    xHeight: number('xHeight', 0, unitsPerEm * 4),
    capHeight: number('capHeight', 0, unitsPerEm * 4)
  }
  return result
}
