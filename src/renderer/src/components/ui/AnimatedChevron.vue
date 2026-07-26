<script setup lang="ts">
import { ChevronDown, ChevronUp } from '@lucide/vue'

defineProps<{ expanded: boolean }>()
</script>

<template>
  <span class="t-icon-swap size-3.5" :data-state="expanded ? 'b' : 'a'" aria-hidden="true">
    <ChevronDown class="t-icon size-3.5" data-icon="a" />
    <ChevronUp class="t-icon size-3.5" data-icon="b" />
  </span>
</template>
