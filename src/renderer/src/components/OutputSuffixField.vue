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
  let error = ''
  if (outputSuffix.length > 50) error = '文件名后缀超过 50 个字符，请缩短后重试'
  else if (outputSuffix.endsWith('.')) error = '文件名后缀不能以句点结尾，请移除末尾的句点'
  else if (invalidCharacter)
    error = '文件名后缀包含系统不支持的字符，请移除 < > : " / \\ | ? * 和控制字符'
  if (error) {
    store.errorMessage = error
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
      在设置的文件名规则中加入 <code>{suffix}</code> 后可使用。
    </small>
  </label>
</template>
