<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{ open: boolean }>()

const rendered = ref(props.open)
const state = ref<'closed' | 'open' | 'closing'>(props.open ? 'open' : 'closed')
let closeTimer: ReturnType<typeof setTimeout> | undefined
let openFrame: number | undefined

function transitionDuration(variable: string, fallback: number): number {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 0
  return (
    Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(variable)) ||
    fallback
  )
}

function clearTimers(): void {
  if (closeTimer) clearTimeout(closeTimer)
  if (openFrame) cancelAnimationFrame(openFrame)
  closeTimer = undefined
  openFrame = undefined
}

async function openPanel(): Promise<void> {
  clearTimers()
  rendered.value = true
  state.value = 'closed'
  await nextTick()
  openFrame = requestAnimationFrame(() => {
    state.value = 'open'
    openFrame = undefined
  })
}

function closePanel(): void {
  clearTimers()
  if (!rendered.value) return
  state.value = 'closing'
  closeTimer = setTimeout(
    () => {
      rendered.value = false
      state.value = 'closed'
      closeTimer = undefined
    },
    transitionDuration('--panel-close-dur', 350)
  )
}

watch(
  () => props.open,
  (open) => {
    if (open) void openPanel()
    else closePanel()
  }
)

onBeforeUnmount(clearTimers)
</script>

<template>
  <div
    v-if="rendered"
    class="t-panel-slide"
    :data-open="state === 'open'"
    :aria-hidden="state !== 'open'"
    :inert="state !== 'open'"
  >
    <slot />
  </div>
</template>
