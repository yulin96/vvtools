<script setup lang="ts">
import { computed } from 'vue'
import { useAppStore } from '../stores/app'

const store = useAppStore()
const suffixEnabled = computed(
  () => store.settings?.outputNameTemplate.includes('{suffix}') ?? false
)

function updateSuffix(event: Event): void {
  if (!store.settings || !suffixEnabled.value) return
  const input = event.target as HTMLInputElement
  const outputSuffix = input.value.trim()
  const invalidCharacter = [...outputSuffix].some(
    (character) => character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character)
  )
  if (outputSuffix.length > 50 || outputSuffix.endsWith('.') || invalidCharacter) {
    store.errorMessage = '文件名后缀不能超过 50 个字符，且不能包含文件名非法字符'
    input.value = store.settings.outputSuffix
    return
  }
  void store.updateSettings({ outputSuffix })
}
</script>

<template>
  <label v-if="store.settings" class="compact-field">
    <span>文件名后缀</span>
    <input
      :value="store.settings.outputSuffix"
      :disabled="!suffixEnabled"
      maxlength="50"
      placeholder="例如 _compressed；留空则不添加"
      @change="updateSuffix"
    />
    <small v-if="suffixEnabled" class="compact-field-hint">
      对应设置中命名模板的 <code>{suffix}</code>；不包含 .png 等格式扩展名。
    </small>
    <small v-else class="compact-field-hint semantic-warning">
      当前命名模板没有 <code>{suffix}</code>，请先在设置中加入。
    </small>
  </label>
</template>
