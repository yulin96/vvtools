<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { X } from '@lucide/vue'
import Button from './ui/Button.vue'

const props = defineProps<{
  open: boolean
  title: string
  description?: string
}>()

const emit = defineEmits<{
  close: []
}>()

const titleId = useId()
const panel = ref<HTMLElement | null>(null)
let previousFocus: HTMLElement | null = null

watch(
  () => props.open,
  (open) => {
    if (open) {
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    }
  }
)

function handleAfterEnter(): void {
  panel.value?.querySelector<HTMLElement>('[data-drawer-autofocus], button, input, select')?.focus()
}

function handleAfterLeave(): void {
  if (previousFocus?.isConnected) {
    previousFocus?.focus()
  }
  previousFocus = null
}

function handleKeydown(event: KeyboardEvent): void {
  if (!props.open || !panel.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }
  if (event.key !== 'Tab') return

  const focusable = [
    ...panel.value.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'
    )
  ].filter((element) => element.offsetParent !== null)
  if (focusable.length === 0) return
  const first = focusable[0]
  const last = focusable.at(-1)!
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

onMounted(() => window.addEventListener('keydown', handleKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', handleKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition
      name="page-settings-drawer"
      @after-enter="handleAfterEnter"
      @after-leave="handleAfterLeave"
    >
      <div v-if="open" class="page-settings-layer">
        <div class="page-settings-backdrop" aria-hidden="true" @click="emit('close')" />
        <aside
          ref="panel"
          class="page-settings-panel"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="titleId"
        >
          <header class="page-settings-header">
            <div>
              <h2 :id="titleId">{{ title }}</h2>
              <p v-if="description">{{ description }}</p>
            </div>
            <Button
              data-drawer-autofocus
              variant="ghost"
              size="icon"
              :aria-label="`关闭${title}`"
              @click="emit('close')"
            >
              <X class="size-4" />
            </Button>
          </header>
          <div class="page-settings-body">
            <slot />
          </div>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>
