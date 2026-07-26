<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

defineProps<{
  active: boolean
}>()

const effectElement = ref<HTMLElement | null>(null)
let animationFrame = 0
let pointerX = 0
let pointerY = 0

function hasFiles(event: DragEvent): boolean {
  return [...(event.dataTransfer?.types || [])].includes('Files')
}

function updatePointer(event: DragEvent): void {
  if (!hasFiles(event)) return
  pointerX = event.clientX
  pointerY = event.clientY
  if (animationFrame) return

  animationFrame = window.requestAnimationFrame(() => {
    animationFrame = 0
    const element = effectElement.value
    if (!element) return

    const bounds = element.getBoundingClientRect()
    const surface = element.parentElement
    if (!surface) return
    const x = Math.min(bounds.width, Math.max(0, pointerX - bounds.left))
    const y = Math.min(bounds.height, Math.max(0, pointerY - bounds.top))
    const normalizedX = bounds.width ? x / bounds.width - 0.5 : 0
    const normalizedY = bounds.height ? y / bounds.height - 0.5 : 0

    surface.style.setProperty('--drop-follow-x', `${x}px`)
    surface.style.setProperty('--drop-follow-y', `${y}px`)
    surface.style.setProperty('--drop-follow-shift-x', `${(normalizedX * 12).toFixed(2)}px`)
    surface.style.setProperty('--drop-follow-shift-y', `${(normalizedY * 12).toFixed(2)}px`)
  })
}

onMounted(() => {
  window.addEventListener('dragover', updatePointer, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('dragover', updatePointer, true)
  if (animationFrame) window.cancelAnimationFrame(animationFrame)
})
</script>

<template>
  <div
    ref="effectElement"
    class="drop-follow-effect"
    :class="{ 'is-active': active }"
    aria-hidden="true"
  >
    <div class="drop-follow-grid" />
    <div class="drop-follow-anchor">
      <div class="drop-follow-orbit" />
      <div class="drop-follow-reticle" />
    </div>
  </div>
</template>
