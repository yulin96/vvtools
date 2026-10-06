export const BATCH_ROW_HEIGHT = 48
export const BATCH_HEADER_HEIGHT = 32
const OVERSCAN = 6

export function virtualRowRange(
  count: number,
  scrollTop: number,
  viewportHeight: number
): {
  start: number
  end: number
  before: number
  after: number
} {
  const visibleCount = Math.max(
    1,
    Math.ceil((viewportHeight - BATCH_HEADER_HEIGHT) / BATCH_ROW_HEIGHT)
  )
  const first = Math.min(
    Math.max(0, Math.floor(scrollTop / BATCH_ROW_HEIGHT)),
    Math.max(0, count - visibleCount)
  )
  const start = Math.max(0, first - OVERSCAN)
  const end = Math.min(count, first + visibleCount + OVERSCAN)
  return { start, end, before: start * BATCH_ROW_HEIGHT, after: (count - end) * BATCH_ROW_HEIGHT }
}
