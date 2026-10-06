import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { BATCH_HEADER_HEIGHT, BATCH_ROW_HEIGHT, virtualRowRange } from '../lib/virtual-rows'

export function useVirtualRows(
  count: Ref<number>,
  viewport = ref<HTMLDivElement>()
): {
  viewport: Ref<HTMLDivElement | undefined>
  range: Ref<ReturnType<typeof virtualRowRange>>
  onScroll: () => void
} {
  const scrollTop = ref(0)
  const height = ref(0)
  let observer: ResizeObserver | undefined
  let frame: number | undefined
  const range = computed(() => virtualRowRange(count.value, scrollTop.value, height.value))

  function measure(): void {
    height.value = viewport.value?.clientHeight ?? 0
    scrollTop.value = viewport.value?.scrollTop ?? 0
  }

  function onScroll(): void {
    if (frame !== undefined) return
    frame = requestAnimationFrame(() => {
      frame = undefined
      scrollTop.value = viewport.value?.scrollTop ?? 0
    })
  }

  onMounted(() => {
    measure()
    observer = new ResizeObserver(measure)
    if (viewport.value) observer.observe(viewport.value)
  })
  watch(
    count,
    () => {
      if (!viewport.value) return
      const maximum = Math.max(
        0,
        count.value * BATCH_ROW_HEIGHT + BATCH_HEADER_HEIGHT - height.value
      )
      viewport.value.scrollTop = Math.min(viewport.value.scrollTop, maximum)
      measure()
    },
    { flush: 'post' }
  )
  onBeforeUnmount(() => {
    observer?.disconnect()
    if (frame !== undefined) cancelAnimationFrame(frame)
  })
  return { viewport, range, onScroll }
}
