<script setup lang="ts">
import { Plus, Trash2 } from '@lucide/vue'
import type {
  VideoAudioMode,
  VideoCodec,
  VideoEncoderMode,
  VideoFormat,
  VideoFrameRate,
  VideoOptions,
  VideoQuality,
  VideoRateControl,
  VideoResolution
} from '../../../shared/types'
import { useAppStore } from '../stores/app'
import PageSettingsDrawer from './PageSettingsDrawer.vue'
import Button from './ui/Button.vue'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const store = useAppStore()

function addPreset(): void {
  if (!store.settings || store.settings.video.presets.length >= 20) return
  void store.updateSettings({
    video: {
      presets: [
        ...store.settings.video.presets,
        {
          id: `preset-${crypto.randomUUID()}`,
          name: '新预设',
          options: { ...store.settings.video.lastOptions }
        }
      ]
    }
  })
}

function updatePresetName(id: string, event: Event): void {
  if (!store.settings) return
  const target = event.target as HTMLInputElement
  const name = target.value.trim()
  const current = store.settings.video.presets.find((preset) => preset.id === id)
  if (!current) return
  if (!name || name.length > 30) {
    store.errorMessage = '预设名称必须是 1–30 个字符'
    target.value = current.name
    return
  }
  void store.updateSettings({
    video: {
      presets: store.settings.video.presets.map((preset) =>
        preset.id === id ? { ...preset, name } : preset
      )
    }
  })
}

function updatePresetOption<K extends keyof VideoOptions>(
  id: string,
  key: K,
  value: VideoOptions[K]
): void {
  if (!store.settings) return
  void store.updateSettings({
    video: {
      presets: store.settings.video.presets.map((preset) =>
        preset.id === id ? { ...preset, options: { ...preset.options, [key]: value } } : preset
      )
    }
  })
}

function removePreset(id: string): void {
  if (!store.settings || store.settings.video.presets.length <= 1) return
  void store.updateSettings({
    video: {
      presets: store.settings.video.presets.filter((preset) => preset.id !== id)
    }
  })
}

function presetSummary(options: VideoOptions): string {
  const format = options.format === 'source' ? '保持原格式' : options.format.toUpperCase()
  if (copiesVideo(options) && options.audioMode === 'copy') {
    return `${format} · 视频和音频保持原始`
  }
  const quality =
    options.rateControl === 'quality'
      ? { high: '高质量', balanced: '均衡', small: '更小体积' }[options.quality]
      : `${options.bitrateMbps} Mbps`
  const codec =
    options.codec === 'source' ? '保持原编码' : options.codec === 'h265' ? 'H.265' : 'H.264'
  const resolution = options.resolution === 'source' ? '原始分辨率' : `最高 ${options.resolution}`
  const encoder =
    options.encoderMode === 'auto'
      ? '自动编码'
      : options.encoderMode === 'hardware'
        ? '硬件编码'
        : 'CPU 编码'
  return `${format} · ${codec} · ${encoder} · ${resolution} · ${quality}`
}

function copiesVideo(options: VideoOptions): boolean {
  return (
    options.codec === 'source' && options.resolution === 'source' && options.frameRate === 'source'
  )
}
</script>

<template>
  <PageSettingsDrawer
    :open="open"
    title="视频设置"
    description="管理视频工作区中可以快速切换的处理预设。"
    @close="emit('close')"
  >
    <section v-if="store.settings" class="page-settings-section">
      <div class="page-settings-section-heading">
        <div>
          <h3>视频预设</h3>
          <p>修改只影响之后开始的任务。</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          :disabled="store.settings.video.presets.length >= 20"
          @click="addPreset"
        >
          <Plus class="size-3.5" />新增预设
        </Button>
      </div>

      <div class="preset-editor-list">
        <article
          v-for="preset in store.settings.video.presets"
          :key="preset.id"
          class="preset-editor"
        >
          <header class="preset-editor-header">
            <div class="min-w-0 flex-1">
              <label class="sr-only" :for="`video-preset-name-${preset.id}`">预设名称</label>
              <input
                :id="`video-preset-name-${preset.id}`"
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
              :disabled="store.settings.video.presets.length <= 1"
              :title="store.settings.video.presets.length <= 1 ? '至少保留一个预设' : '删除预设'"
              @click="removePreset(preset.id)"
            >
              <Trash2 class="size-3.5" />删除
            </Button>
          </header>

          <div class="preset-fields page-settings-preset-fields">
            <label class="compact-field">
              <span>格式</span>
              <select
                :value="preset.options.format"
                @change="
                  updatePresetOption(
                    preset.id,
                    'format',
                    ($event.target as HTMLSelectElement).value as VideoFormat
                  )
                "
              >
                <option value="source">保持原格式</option>
                <option value="mp4">MP4</option>
                <option value="mov">MOV</option>
                <option value="mkv">MKV</option>
              </select>
            </label>
            <label class="compact-field">
              <span>视频编码</span>
              <select
                :value="preset.options.codec"
                @change="
                  updatePresetOption(
                    preset.id,
                    'codec',
                    ($event.target as HTMLSelectElement).value as VideoCodec
                  )
                "
              >
                <option value="source">保持原编码</option>
                <option value="h264">H.264</option>
                <option value="h265">H.265</option>
              </select>
            </label>
            <label class="compact-field">
              <span>编码设备</span>
              <select
                :value="preset.options.encoderMode"
                @change="
                  updatePresetOption(
                    preset.id,
                    'encoderMode',
                    ($event.target as HTMLSelectElement).value as VideoEncoderMode
                  )
                "
              >
                <option value="auto">自动检测</option>
                <option value="software">CPU · 兼容优先</option>
                <option value="hardware">硬件 · 速度优先</option>
              </select>
            </label>
            <label class="compact-field">
              <span>分辨率</span>
              <select
                :value="preset.options.resolution"
                @change="
                  updatePresetOption(
                    preset.id,
                    'resolution',
                    ($event.target as HTMLSelectElement).value as VideoResolution
                  )
                "
              >
                <option value="source">保持原始</option>
                <option value="1080p">最高 1080p</option>
                <option value="720p">最高 720p</option>
              </select>
            </label>
            <label class="compact-field" :class="{ 'opacity-45': copiesVideo(preset.options) }">
              <span>压缩方式</span>
              <select
                :value="preset.options.rateControl"
                :disabled="copiesVideo(preset.options)"
                @change="
                  updatePresetOption(
                    preset.id,
                    'rateControl',
                    ($event.target as HTMLSelectElement).value as VideoRateControl
                  )
                "
              >
                <option value="quality">按质量</option>
                <option value="bitrate">目标码率</option>
              </select>
            </label>
            <label class="compact-field" :class="{ 'opacity-45': copiesVideo(preset.options) }">
              <span>{{ preset.options.rateControl === 'quality' ? '质量' : '视频码率' }}</span>
              <select
                v-if="preset.options.rateControl === 'quality'"
                :value="preset.options.quality"
                :disabled="copiesVideo(preset.options)"
                @change="
                  updatePresetOption(
                    preset.id,
                    'quality',
                    ($event.target as HTMLSelectElement).value as VideoQuality
                  )
                "
              >
                <option value="high">高质量</option>
                <option value="balanced">均衡</option>
                <option value="small">更小体积</option>
              </select>
              <div v-else class="number-field">
                <input
                  :value="preset.options.bitrateMbps"
                  :disabled="copiesVideo(preset.options)"
                  type="number"
                  min="0.5"
                  max="100"
                  step="0.5"
                  @change="
                    updatePresetOption(
                      preset.id,
                      'bitrateMbps',
                      Number(($event.target as HTMLInputElement).value)
                    )
                  "
                /><span>Mbps</span>
              </div>
            </label>
            <label class="compact-field">
              <span>帧率</span>
              <select
                :value="preset.options.frameRate"
                @change="
                  updatePresetOption(
                    preset.id,
                    'frameRate',
                    ($event.target as HTMLSelectElement).value as VideoFrameRate
                  )
                "
              >
                <option value="source">保持原始</option>
                <option value="24">24 fps</option>
                <option value="25">25 fps</option>
                <option value="30">30 fps</option>
                <option value="60">60 fps</option>
              </select>
            </label>
            <label class="compact-field">
              <span>音频</span>
              <select
                :value="preset.options.audioMode"
                @change="
                  updatePresetOption(
                    preset.id,
                    'audioMode',
                    ($event.target as HTMLSelectElement).value as VideoAudioMode
                  )
                "
              >
                <option value="aac">转为 AAC</option>
                <option value="copy">复制原音频</option>
                <option value="none">移除音频</option>
              </select>
            </label>
            <label
              class="compact-field"
              :class="{ 'opacity-45': preset.options.audioMode !== 'aac' }"
            >
              <span>音频码率</span>
              <select
                :value="preset.options.audioBitrateKbps"
                :disabled="preset.options.audioMode !== 'aac'"
                @change="
                  updatePresetOption(
                    preset.id,
                    'audioBitrateKbps',
                    Number(($event.target as HTMLSelectElement).value)
                  )
                "
              >
                <option :value="96">96 kbps</option>
                <option :value="128">128 kbps</option>
                <option :value="192">192 kbps</option>
                <option :value="256">256 kbps</option>
              </select>
            </label>
          </div>
        </article>
      </div>
    </section>
  </PageSettingsDrawer>
</template>
