<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ value: number | null }>()
const width = computed(() => `${Math.min(100, Math.max(0, props.value || 0))}%`)
</script>

<template>
  <div
    class="h-1.5 w-full overflow-hidden rounded-full bg-muted"
    role="progressbar"
    :aria-valuenow="value ?? undefined"
  >
    <div
      v-if="value !== null"
      class="h-full rounded-full bg-signal transition-[width]"
      :style="{ width }"
    />
    <div v-else class="indeterminate-progress h-full w-1/3 rounded-full bg-signal" />
  </div>
</template>
