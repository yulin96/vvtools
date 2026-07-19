<script setup lang="ts">
import { useAppStore } from '../stores/app'

const store = useAppStore()

function updateSuffix(event: Event): void {
  if (!store.settings) return
  const input = event.target as HTMLInputElement
  const outputSuffix = input.value.trim()
  const invalidCharacter = [...outputSuffix].some(
    (character) => character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character)
  )
  if (outputSuffix.length > 50 || outputSuffix.endsWith('.') || invalidCharacter) {
    store.errorMessage = '输出文件后缀不能超过 50 个字符，且不能包含文件名非法字符'
    input.value = store.settings.outputSuffix
    return
  }
  void store.updateSettings({ outputSuffix })
}
</script>

<template>
  <label v-if="store.settings" class="compact-field">
    <span>输出文件后缀</span>
    <input
      :value="store.settings.outputSuffix"
      maxlength="50"
      placeholder="留空则保持原文件名"
      @change="updateSuffix"
    />
  </label>
</template>
