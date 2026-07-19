<script setup lang="ts">
import { FolderCog, FolderOpen } from '@lucide/vue'
import type { OutputMode } from '../../../shared/types'
import { useAppStore } from '../stores/app'
import Button from './ui/Button.vue'

const store = useAppStore()

async function updateOutputMode(event: Event): Promise<void> {
  if (!store.settings) return
  const select = event.target as HTMLSelectElement
  const previousMode = store.settings.outputMode
  const outputMode = select.value as OutputMode
  try {
    if (outputMode === 'source') {
      await store.updateSettings({ outputMode })
      return
    }

    const path = await window.api.selectOutputDirectory(store.settings.outputDirectory)
    if (path) await store.updateSettings({ outputMode, outputDirectory: path })
    else select.value = previousMode
  } catch (error) {
    select.value = previousMode
    store.errorMessage = error instanceof Error ? error.message : String(error)
  }
}

async function chooseOutput(): Promise<void> {
  if (!store.settings) return
  try {
    const path = await window.api.selectOutputDirectory(store.settings.outputDirectory)
    if (path) await store.updateSettings({ outputMode: 'custom', outputDirectory: path })
  } catch (error) {
    store.errorMessage = error instanceof Error ? error.message : String(error)
  }
}
</script>

<template>
  <div v-if="store.settings" class="header-output-control">
    <label class="output-mode-picker">
      <span class="sr-only">输出位置</span>
      <select :value="store.settings.outputMode" aria-label="输出位置" @change="updateOutputMode">
        <option value="source">输出到原目录</option>
        <option value="custom">输出到指定目录</option>
      </select>
    </label>
    <Button
      v-if="store.settings.outputMode === 'custom'"
      variant="secondary"
      size="icon"
      :title="`选择输出目录：${store.settings.outputDirectory}`"
      aria-label="选择输出目录"
      @click="chooseOutput"
    >
      <FolderCog class="size-4" />
    </Button>
    <Button
      v-if="store.settings.outputMode === 'custom'"
      variant="secondary"
      size="icon"
      title="打开输出目录"
      aria-label="打开输出目录"
      @click="store.openOutputDirectory()"
    >
      <FolderOpen class="size-4" />
    </Button>
  </div>
</template>
