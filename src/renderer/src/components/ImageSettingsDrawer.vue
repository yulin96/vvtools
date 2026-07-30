<script setup lang="ts">
import { Plus, Trash2 } from '@lucide/vue'
import type { AppSettings, ImagePresetOptions } from '../../../shared/types'
import { getImagePresetOptions } from '../../../shared/constants'
import { useAppStore } from '../stores/app'
import PageSettingsDrawer from './PageSettingsDrawer.vue'
import Button from './ui/Button.vue'
import ToggleSwitch from './ui/ToggleSwitch.vue'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const store = useAppStore()

function updateImagePreference(patch: Partial<AppSettings['image']['lastOptions']>): void {
  if (!store.settings) return
  void store.updateSettings({
    image: {
      lastOptions: { ...store.settings.image.lastOptions, ...patch }
    }
  })
}

function addPreset(): void {
  if (!store.settings || store.settings.image.presets.length >= 20) return
  void store.updateSettings({
    image: {
      presets: [
        ...store.settings.image.presets,
        {
          id: `image-preset-${crypto.randomUUID()}`,
          name: '新预设',
          options: getImagePresetOptions(store.settings.image.lastOptions)
        }
      ]
    }
  })
}

function updatePresetName(id: string, event: Event): void {
  if (!store.settings) return
  const target = event.target as HTMLInputElement
  const name = target.value.trim()
  const current = store.settings.image.presets.find((preset) => preset.id === id)
  if (!current) return
  if (!name || name.length > 30) {
    store.errorMessage = '预设名称必须是 1–30 个字符'
    target.value = current.name
    return
  }
  void store.updateSettings({
    image: {
      presets: store.settings.image.presets.map((preset) =>
        preset.id === id ? { ...preset, name } : preset
      )
    }
  })
}

function updatePresetOption<K extends keyof ImagePresetOptions>(
  id: string,
  key: K,
  value: ImagePresetOptions[K]
): void {
  if (!store.settings) return
  void store.updateSettings({
    image: {
      presets: store.settings.image.presets.map((preset) =>
        preset.id === id ? { ...preset, options: { ...preset.options, [key]: value } } : preset
      )
    }
  })
}

function removePreset(id: string): void {
  if (!store.settings || store.settings.image.presets.length <= 1) return
  void store.updateSettings({
    image: {
      presets: store.settings.image.presets.filter((preset) => preset.id !== id)
    }
  })
}

function presetSummary(options: ImagePresetOptions): string {
  const format = options.format === 'original' ? '保持原格式' : options.format.toUpperCase()
  const compression =
    options.compressionMode === 'quality'
      ? `质量 ${options.quality}`
      : `不超过 ${options.targetSizeKb} KB`
  const resize =
    options.resizeMode === 'source'
      ? '原始尺寸'
      : options.resizeMode === 'width'
        ? `宽 ${options.width}px`
        : options.resizeMode === 'height'
          ? `高 ${options.height}px`
          : `${options.percentage}%`
  return `${format} · ${compression} · ${resize}`
}
</script>

<template>
  <PageSettingsDrawer
    :open="open"
    title="图片设置"
    description="管理图片预设和不会随预设切换的处理偏好。"
    @close="emit('close')"
  >
    <template v-if="store.settings">
      <section class="page-settings-section">
        <div class="page-settings-section-heading">
          <div>
            <h3>图片预设</h3>
            <p>预设只保存压缩、质量、尺寸和输出格式。</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            :disabled="store.settings.image.presets.length >= 20"
            @click="addPreset"
          >
            <Plus class="size-3.5" />新增预设
          </Button>
        </div>

        <div class="preset-editor-list">
          <article
            v-for="preset in store.settings.image.presets"
            :key="preset.id"
            class="preset-editor"
          >
            <header class="preset-editor-header">
              <div class="min-w-0 flex-1">
                <label class="sr-only" :for="`image-preset-name-${preset.id}`">预设名称</label>
                <input
                  :id="`image-preset-name-${preset.id}`"
                  :value="preset.name"
                  class="preset-name-input"
                  maxlength="30"
                  @change="updatePresetName(preset.id, $event)"
                />
                <p>{{ presetSummary(preset.options) }}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                :disabled="store.settings.image.presets.length <= 1"
                :title="store.settings.image.presets.length <= 1 ? '至少保留一个预设' : '删除预设'"
                @click="removePreset(preset.id)"
              >
                <Trash2 class="size-3.5" />删除
              </Button>
            </header>

            <div class="preset-fields page-settings-preset-fields">
              <label class="compact-field">
                <span>压缩模式</span>
                <select
                  :value="preset.options.compressionMode"
                  @change="
                    updatePresetOption(
                      preset.id,
                      'compressionMode',
                      ($event.target as HTMLSelectElement)
                        .value as ImagePresetOptions['compressionMode']
                    )
                  "
                >
                  <option value="quality">按图片质量</option>
                  <option value="targetSize">按目标大小</option>
                </select>
              </label>
              <label class="compact-field">
                <span>{{
                  preset.options.compressionMode === 'quality' ? '图片质量' : '目标大小'
                }}</span>
                <div class="number-field">
                  <input
                    v-if="preset.options.compressionMode === 'quality'"
                    :value="preset.options.quality"
                    type="number"
                    min="1"
                    max="100"
                    @change="
                      updatePresetOption(
                        preset.id,
                        'quality',
                        Number(($event.target as HTMLInputElement).value)
                      )
                    "
                  />
                  <input
                    v-else
                    :value="preset.options.targetSizeKb"
                    type="number"
                    min="1"
                    max="100000"
                    @change="
                      updatePresetOption(
                        preset.id,
                        'targetSizeKb',
                        Number(($event.target as HTMLInputElement).value)
                      )
                    "
                  />
                  <span>{{ preset.options.compressionMode === 'quality' ? '/ 100' : 'KB' }}</span>
                </div>
              </label>
              <label class="compact-field">
                <span>调整方式</span>
                <select
                  :value="preset.options.resizeMode"
                  @change="
                    updatePresetOption(
                      preset.id,
                      'resizeMode',
                      ($event.target as HTMLSelectElement).value as ImagePresetOptions['resizeMode']
                    )
                  "
                >
                  <option value="source">保持原始尺寸</option>
                  <option value="width">指定宽度</option>
                  <option value="height">指定高度</option>
                  <option value="percentage">按百分比</option>
                </select>
              </label>
              <label class="compact-field">
                <span>尺寸参数</span>
                <div class="number-field">
                  <input
                    v-if="preset.options.resizeMode === 'width'"
                    :value="preset.options.width"
                    type="number"
                    min="1"
                    max="32768"
                    @change="
                      updatePresetOption(
                        preset.id,
                        'width',
                        Number(($event.target as HTMLInputElement).value)
                      )
                    "
                  />
                  <input
                    v-else-if="preset.options.resizeMode === 'height'"
                    :value="preset.options.height"
                    type="number"
                    min="1"
                    max="32768"
                    @change="
                      updatePresetOption(
                        preset.id,
                        'height',
                        Number(($event.target as HTMLInputElement).value)
                      )
                    "
                  />
                  <input
                    v-else-if="preset.options.resizeMode === 'percentage'"
                    :value="preset.options.percentage"
                    type="number"
                    min="1"
                    max="1000"
                    @change="
                      updatePresetOption(
                        preset.id,
                        'percentage',
                        Number(($event.target as HTMLInputElement).value)
                      )
                    "
                  />
                  <input v-else value="无需设置" disabled />
                  <span v-if="['width', 'height'].includes(preset.options.resizeMode)">px</span>
                  <span v-else-if="preset.options.resizeMode === 'percentage'">%</span>
                </div>
              </label>
              <label class="compact-field">
                <span>输出格式</span>
                <select
                  :value="preset.options.format"
                  @change="
                    updatePresetOption(
                      preset.id,
                      'format',
                      ($event.target as HTMLSelectElement).value as ImagePresetOptions['format']
                    )
                  "
                >
                  <option value="original">保持原格式</option>
                  <option value="jpeg">JPEG</option>
                  <option value="png">PNG</option>
                  <option value="webp">WebP</option>
                  <option value="avif">AVIF</option>
                </select>
              </label>
            </div>
          </article>
        </div>
      </section>

      <section class="page-settings-section">
        <div class="page-settings-section-heading">
          <div>
            <h3>处理偏好</h3>
            <p>这些选项独立于预设，切换预设时保持不变。</p>
          </div>
        </div>
        <div class="page-settings-preferences">
          <label class="compact-field">
            <span>元数据</span>
            <select
              :value="store.settings.image.lastOptions.metadataMode"
              @change="
                updateImagePreference({
                  metadataMode: ($event.target as HTMLSelectElement)
                    .value as AppSettings['image']['lastOptions']['metadataMode']
                })
              "
            >
              <option value="colorProfile">尽可能保留色彩配置</option>
              <option value="strip">全部移除</option>
              <option value="all">尽可能全部保留</option>
            </select>
          </label>
          <ToggleSwitch
            label="目录结构"
            :model-value="store.settings.image.lastOptions.preserveStructure"
            enabled-text="保留层级"
            disabled-text="合并输出"
            @update:model-value="updateImagePreference({ preserveStructure: $event })"
          />
          <ToggleSwitch
            label="较小图片"
            :model-value="store.settings.image.lastOptions.allowEnlargement"
            enabled-text="允许放大"
            disabled-text="不放大"
            @update:model-value="updateImagePreference({ allowEnlargement: $event })"
          />
        </div>
      </section>
    </template>
  </PageSettingsDrawer>
</template>
