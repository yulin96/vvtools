<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  label: string
  modelValue: boolean
  enabledText: string
  disabledText: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const stateText = computed(() => (props.modelValue ? props.enabledText : props.disabledText))
</script>

<template>
  <div class="compact-field">
    <span>{{ label }}</span>
    <button
      type="button"
      class="switch-field-control"
      role="switch"
      :aria-checked="modelValue"
      :aria-label="`${label}：${stateText}`"
      @click="emit('update:modelValue', !modelValue)"
    >
      <span class="switch-track" aria-hidden="true">
        <span class="switch-thumb" />
      </span>
      <span class="switch-state-text">{{ stateText }}</span>
    </button>
  </div>
</template>
