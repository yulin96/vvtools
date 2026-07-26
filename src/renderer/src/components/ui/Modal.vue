<script setup lang="ts">
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle
} from 'reka-ui'
import { X } from '@lucide/vue'

defineProps<{ open: boolean; title: string; description?: string }>()
defineEmits<{ 'update:open': [value: boolean] }>()
</script>

<template>
  <DialogRoot :open="open" @update:open="$emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="modal-overlay fixed inset-0 z-40" />
      <DialogContent
        class="modal-content fixed left-1/2 top-1/2 z-50 max-h-[80vh] w-[min(620px,calc(100vw-32px))] overflow-auto rounded-2xl border border-border bg-background p-6 focus:outline-none"
      >
        <div class="pr-8">
          <DialogTitle class="text-base font-semibold text-foreground">{{ title }}</DialogTitle>
          <DialogDescription v-if="description" class="mt-1 text-sm text-muted-foreground">{{
            description
          }}</DialogDescription>
        </div>
        <slot />
        <DialogClose
          class="modal-close absolute right-4 top-4 rounded p-1 text-muted-foreground hover:bg-muted"
          aria-label="关闭"
        >
          <X class="size-4" />
        </DialogClose>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
