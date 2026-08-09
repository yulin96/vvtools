<script setup lang="ts">
import { computed } from 'vue'
import type { AppSettingsPatch, TaskKind } from '../../../shared/types'
import { useAppStore } from '../stores/app'

const props = defineProps<{ kind: TaskKind }>()
const store = useAppStore()
const mediaSettings = computed(() => store.settings?.[props.kind])
const suffixHintId = computed(() => `${props.kind}-output-suffix-hint`)
const suffixEnabled = computed(
  () => store.settings?.common.outputNameTemplate.includes('{suffix}') ?? false
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
    input.value = mediaSettings.value?.outputSuffix ?? ''
    return
  }
  void store.updateSettings({ [props.kind]: { outputSuffix } } as AppSettingsPatch)
}
</script>

<template>
  <label v-if="store.settings && mediaSettings" class="compact-field">
    <span>文件名后缀</span>
    <input
      :value="mediaSettings.outputSuffix"
      :disabled="!suffixEnabled"
      :aria-describedby="!suffixEnabled ? suffixHintId : undefined"
      maxlength="50"
      placeholder="例如 _compressed；留空不添加"
      title="添加在原文件名后，不包含格式扩展名"
      @change="updateSuffix"
    />
    <small v-if="!suffixEnabled" :id="suffixHintId" class="compact-field-hint semantic-warning">
      文件名规则未使用 <code>{suffix}</code>，当前后缀不会生效。
    </small>
  </label>
</template>
