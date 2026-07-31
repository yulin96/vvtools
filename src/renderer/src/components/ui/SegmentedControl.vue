<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId, watch, type Component } from 'vue'

type SegmentedValue = string | number

interface SegmentedOption {
  value: SegmentedValue
  label: string
  title?: string
  ariaLabel?: string
  icon?: Component
}

const props = defineProps<{
  label: string
  modelValue: SegmentedValue
  options: SegmentedOption[]
  disabled?: boolean
  hideLabel?: boolean
  iconOnly?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: SegmentedValue]
}>()

const controlId = useId()
const bar = ref<HTMLElement | null>(null)
const pill = ref<HTMLElement | null>(null)
let resizeObserver: ResizeObserver | null = null

function movePill(animate: boolean): void {
  const activeIndex = props.options.findIndex((option) => option.value === props.modelValue)
  const activeOption = bar.value?.querySelectorAll<HTMLElement>('.t-tab')[activeIndex]
  if (!activeOption || !pill.value) return

  if (!animate) {
    const previousTransition = pill.value.style.transition
    pill.value.style.transition = 'none'
    pill.value.style.transform = `translateX(${activeOption.offsetLeft}px)`
    pill.value.style.width = `${activeOption.offsetWidth}px`
    void pill.value.offsetWidth
    pill.value.style.transition = previousTransition
    return
  }

  pill.value.style.transform = `translateX(${activeOption.offsetLeft}px)`
  pill.value.style.width = `${activeOption.offsetWidth}px`
}

function handleResize(): void {
  movePill(false)
}

watch(
  () => [props.modelValue, props.options.length],
  async () => {
    await nextTick()
    movePill(true)
  }
)

onMounted(() => {
  requestAnimationFrame(() => movePill(false))
  resizeObserver = new ResizeObserver(() => movePill(false))
  if (bar.value) resizeObserver.observe(bar.value)
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  window.removeEventListener('resize', handleResize)
})
</script>

<template>
  <div class="compact-field">
    <span :id="`${controlId}-label`" :class="{ 'sr-only': hideLabel }">{{ label }}</span>
    <div
      ref="bar"
      class="segmented-control t-tabs"
      role="radiogroup"
      :aria-labelledby="`${controlId}-label`"
      :aria-disabled="disabled || undefined"
    >
      <span ref="pill" class="t-tabs-pill" aria-hidden="true" />
      <label
        v-for="option in options"
        :key="option.value"
        class="segmented-control-option t-tab"
        :data-selected="modelValue === option.value"
        :title="option.title ?? (iconOnly ? option.label : undefined)"
      >
        <input
          class="segmented-control-input"
          type="radio"
          :name="controlId"
          :value="option.value"
          :checked="modelValue === option.value"
          :disabled="disabled"
          :aria-label="option.ariaLabel ?? (iconOnly ? option.label : undefined)"
          @change="emit('update:modelValue', option.value)"
        />
        <span class="segmented-control-label">
          <component :is="option.icon" v-if="option.icon" class="size-4" aria-hidden="true" />
          <span v-if="!iconOnly">{{ option.label }}</span>
        </span>
      </label>
    </div>
  </div>
</template>
