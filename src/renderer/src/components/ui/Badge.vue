<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '../../lib/utils'

const props = defineProps<{
  tone?: 'neutral' | 'info' | 'success' | 'danger' | 'warning'
  class?: string
}>()

const classes = computed(() =>
  cn(
    'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
    {
      'bg-muted text-muted-foreground': !props.tone || props.tone === 'neutral',
      'bg-cyan-50 text-cyan-800': props.tone === 'info',
      'bg-emerald-50 text-emerald-800': props.tone === 'success',
      'bg-red-50 text-red-800': props.tone === 'danger',
      'bg-amber-50 text-amber-800': props.tone === 'warning'
    },
    props.class
  )
)
</script>

<template>
  <span :class="classes"><slot /></span>
</template>
