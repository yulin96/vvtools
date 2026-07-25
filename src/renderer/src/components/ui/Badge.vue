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
      'badge-info': props.tone === 'info',
      'badge-success': props.tone === 'success',
      'badge-danger': props.tone === 'danger',
      'badge-warning': props.tone === 'warning'
    },
    props.class
  )
)
</script>

<template>
  <span :class="classes"><slot /></span>
</template>
