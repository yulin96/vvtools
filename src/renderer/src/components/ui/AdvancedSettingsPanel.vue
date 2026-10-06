<script setup lang="ts">
import { ref } from 'vue'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { SlidersHorizontal } from '@lucide/vue'
import Button from './Button.vue'

defineProps<{ label: string }>()

const open = ref(false)
const fields = ref<HTMLElement | null>(null)

function setOpen(value: boolean): void {
  const activeElement = document.activeElement
  if (!value && activeElement instanceof HTMLElement && fields.value?.contains(activeElement)) {
    activeElement.blur()
  }
  open.value = value
}
</script>

<template>
  <PopoverRoot :open="open" @update:open="setOpen">
    <PopoverTrigger as-child>
      <Button class="config-expand-toggle" variant="secondary" size="sm" :aria-label="label">
        <SlidersHorizontal class="size-3.5" aria-hidden="true" />
        更多设置
      </Button>
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        class="advanced-settings-popover"
        align="start"
        :side-offset="8"
        :collision-padding="16"
      >
        <div ref="fields">
          <slot />
        </div>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
