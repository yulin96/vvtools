<script setup lang="ts">
import { Cpu, Image, Plus, RefreshCw, Trash2, Video } from '@lucide/vue'
import type {
  AppSettings,
  VideoAudioMode,
  VideoCodec,
  VideoFormat,
  VideoFrameRate,
  VideoOptions,
  VideoQuality,
  VideoRateControl,
  VideoResolution
} from '../../../shared/types'
import { useAppStore } from '../stores/app'
import Badge from '../components/ui/Badge.vue'
import Button from '../components/ui/Button.vue'
import ToggleSwitch from '../components/ui/ToggleSwitch.vue'

const store = useAppStore()

function capabilityLabel(name: string): string {
  return { ffmpeg: 'FFmpeg', ffprobe: 'FFprobe', sharp: 'sharp' }[name] ?? name
}

function updateConcurrency(event: Event): void {
  void store.updateSettings({ concurrency: Number((event.target as HTMLSelectElement).value) })
}

function updateHistoryRetention(event: Event): void {
  void store.updateSettings({
    historyRetentionDays: Number((event.target as HTMLSelectElement).value)
  })
}

function updateCloseBehavior(event: Event): void {
  if (!store.settings) return
  void store.updateSettings({
    closeBehavior: (event.target as HTMLSelectElement).value as AppSettings['closeBehavior']
  })
}

function updateNested<K extends 'image'>(key: K, patch: Partial<AppSettings[K]>): void {
  if (!store.settings) return
  void store.updateSettings({ [key]: { ...store.settings[key], ...patch } })
}

function addPreset(): void {
  if (!store.settings || store.settings.videoPresets.length >= 20) return
  void store.updateSettings({
    videoPresets: [
      ...store.settings.videoPresets,
      {
        id: `preset-${crypto.randomUUID()}`,
        name: '新预设',
        options: { ...store.settings.video }
      }
    ]
  })
}

function updatePresetName(id: string, event: Event): void {
  if (!store.settings) return
  const target = event.target as HTMLInputElement
  const name = target.value.trim()
  const current = store.settings.videoPresets.find((preset) => preset.id === id)
  if (!current) return
  if (!name || name.length > 30) {
    store.errorMessage = '预设名称必须是 1–30 个字符'
    target.value = current.name
    return
  }
  void store.updateSettings({
    videoPresets: store.settings.videoPresets.map((preset) =>
      preset.id === id ? { ...preset, name } : preset
    )
  })
}

function updatePresetOption<K extends keyof VideoOptions>(
  id: string,
  key: K,
  value: VideoOptions[K]
): void {
  if (!store.settings) return
  void store.updateSettings({
    videoPresets: store.settings.videoPresets.map((preset) => {
      if (preset.id !== id) return preset
      return { ...preset, options: { ...preset.options, [key]: value } }
    })
  })
}

function removePreset(id: string): void {
  if (!store.settings || store.settings.videoPresets.length <= 1) return
  void store.updateSettings({
    videoPresets: store.settings.videoPresets.filter((preset) => preset.id !== id)
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
  return `${format} · ${codec} · ${resolution} · ${quality}`
}

function copiesVideo(options: VideoOptions): boolean {
  return (
    options.codec === 'source' && options.resolution === 'source' && options.frameRate === 'source'
  )
}
</script>

<template>
  <div class="page-container">
    <header class="page-header">
      <div>
        <h1>设置</h1>
        <p>管理任务执行方式、视频预设和图片默认参数。</p>
      </div>
    </header>
    <template v-if="store.settings">
      <section class="settings-card">
        <div class="settings-card-title">
          <Cpu class="size-4" />
          <div>
            <h2>任务执行</h2>
            <p>控制同时处理的文件数量。</p>
          </div>
        </div>
        <div class="flex gap-4">
          <label class="field-label w-56">
            <span>并发数</span>
            <select
              :value="store.settings.concurrency"
              class="field-control"
              @change="updateConcurrency"
            >
              <option v-for="value in 4" :key="value" :value="value">
                {{ value }}{{ value === 1 ? '（推荐）' : '' }}
              </option>
            </select>
          </label>
          <label class="field-label w-56">
            <span>历史记录保留</span>
            <select
              :value="store.settings.historyRetentionDays"
              class="field-control"
              @change="updateHistoryRetention"
            >
              <option :value="7">7 天</option>
              <option :value="30">30 天（推荐）</option>
              <option :value="90">90 天</option>
            </select>
          </label>
          <label class="field-label w-56">
            <span>有任务时关闭窗口</span>
            <select
              :value="store.settings.closeBehavior"
              class="field-control"
              @change="updateCloseBehavior"
            >
              <option value="ask">每次询问（推荐）</option>
              <option value="minimizeToTray">后台继续处理</option>
              <option value="quit">取消任务并退出</option>
            </select>
          </label>
        </div>
      </section>

      <section class="settings-card settings-card-stack">
        <div class="settings-section-heading">
          <div class="settings-card-title">
            <Video class="size-4" />
            <div>
              <h2>视频预设</h2>
              <p>预设会显示在视频工作区顶部；修改只影响之后开始的任务。</p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            :disabled="store.settings.videoPresets.length >= 20"
            @click="addPreset"
          >
            <Plus class="size-3.5" />新增预设
          </Button>
        </div>

        <div class="preset-editor-list">
          <article
            v-for="preset in store.settings.videoPresets"
            :key="preset.id"
            class="preset-editor"
          >
            <header class="preset-editor-header">
              <div class="min-w-0 flex-1">
                <label class="sr-only" :for="`preset-name-${preset.id}`">预设名称</label>
                <input
                  :id="`preset-name-${preset.id}`"
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
                :disabled="store.settings.videoPresets.length <= 1"
                :title="store.settings.videoPresets.length <= 1 ? '至少保留一个预设' : '删除预设'"
                @click="removePreset(preset.id)"
              >
                <Trash2 class="size-3.5" />删除
              </Button>
            </header>

            <div class="preset-fields">
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
                :class="{
                  'opacity-45': preset.options.audioMode !== 'aac'
                }"
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

      <section class="settings-card settings-card-stack">
        <div class="settings-card-title">
          <Image class="size-4" />
          <div>
            <h2>图片默认参数</h2>
            <p>作为图片工作区的初始参数；修改只影响之后开始的任务。</p>
          </div>
        </div>
        <div class="preset-fields w-full">
          <label class="compact-field">
            <span>压缩模式</span>
            <select
              :value="store.settings.image.compressionMode"
              @change="
                updateNested('image', {
                  compressionMode: ($event.target as HTMLSelectElement)
                    .value as AppSettings['image']['compressionMode']
                })
              "
            >
              <option value="quality">按图片质量</option>
              <option value="targetSize">按目标大小</option>
            </select>
          </label>
          <label class="compact-field">
            <span>{{
              store.settings.image.compressionMode === 'quality' ? '图片质量' : '目标大小'
            }}</span>
            <div class="number-field">
              <input
                v-if="store.settings.image.compressionMode === 'quality'"
                type="number"
                min="1"
                max="100"
                :value="store.settings.image.quality"
                @change="
                  updateNested('image', {
                    quality: Number(($event.target as HTMLInputElement).value)
                  })
                "
              />
              <input
                v-else
                type="number"
                min="1"
                max="100000"
                :value="store.settings.image.targetSizeKb"
                @change="
                  updateNested('image', {
                    targetSizeKb: Number(($event.target as HTMLInputElement).value)
                  })
                "
              />
              <span>{{ store.settings.image.compressionMode === 'quality' ? '/ 100' : 'KB' }}</span>
            </div>
          </label>
          <label class="compact-field">
            <span>调整方式</span>
            <select
              :value="store.settings.image.resizeMode"
              @change="
                updateNested('image', {
                  resizeMode: ($event.target as HTMLSelectElement)
                    .value as AppSettings['image']['resizeMode']
                })
              "
            >
              <option value="source">保持原始尺寸</option>
              <option value="width">指定宽度</option>
              <option value="height">指定高度</option>
              <option value="percentage">按百分比</option>
            </select>
          </label>
          <label
            class="compact-field"
            :class="{ 'opacity-45': store.settings.image.resizeMode === 'source' }"
          >
            <span>尺寸参数</span>
            <div class="number-field">
              <input
                v-if="store.settings.image.resizeMode === 'width'"
                type="number"
                min="1"
                max="32768"
                :value="store.settings.image.width"
                @change="
                  updateNested('image', {
                    width: Number(($event.target as HTMLInputElement).value)
                  })
                "
              />
              <input
                v-else-if="store.settings.image.resizeMode === 'height'"
                type="number"
                min="1"
                max="32768"
                :value="store.settings.image.height"
                @change="
                  updateNested('image', {
                    height: Number(($event.target as HTMLInputElement).value)
                  })
                "
              />
              <input
                v-else-if="store.settings.image.resizeMode === 'percentage'"
                type="number"
                min="1"
                max="1000"
                :value="store.settings.image.percentage"
                @change="
                  updateNested('image', {
                    percentage: Number(($event.target as HTMLInputElement).value)
                  })
                "
              />
              <input v-else value="无需设置" disabled />
              <span v-if="['width', 'height'].includes(store.settings.image.resizeMode)">px</span>
              <span v-else-if="store.settings.image.resizeMode === 'percentage'">%</span>
            </div>
          </label>
          <label class="compact-field">
            <span>输出格式</span>
            <select
              :value="store.settings.image.format"
              @change="
                updateNested('image', {
                  format: ($event.target as HTMLSelectElement)
                    .value as AppSettings['image']['format']
                })
              "
            >
              <option value="original">保持原格式</option>
              <option value="jpeg">JPEG</option>
              <option value="png">PNG</option>
              <option value="webp">WebP</option>
            </select>
          </label>
          <ToggleSwitch
            label="目录结构"
            :model-value="store.settings.image.preserveStructure"
            enabled-text="保留层级"
            disabled-text="合并输出"
            @update:model-value="updateNested('image', { preserveStructure: $event })"
          />
          <ToggleSwitch
            label="较小图片"
            :model-value="store.settings.image.allowEnlargement"
            enabled-text="允许放大"
            disabled-text="不放大"
            @update:model-value="updateNested('image', { allowEnlargement: $event })"
          />
        </div>
      </section>

      <section class="settings-card">
        <div class="settings-card-title">
          <RefreshCw class="size-4" />
          <div>
            <h2>处理组件</h2>
            <p>媒体任务开始前会再次校验文件。</p>
          </div>
        </div>
        <div class="space-y-3">
          <div
            v-for="(item, name) in store.capabilities"
            :key="name"
            class="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2.5"
          >
            <div class="min-w-0">
              <p class="text-sm font-medium">{{ capabilityLabel(name) }}</p>
              <p class="truncate text-xs text-muted-foreground" :title="item.version || item.error">
                {{ item.version || item.error || '正在检测…' }}
              </p>
            </div>
            <Badge :tone="item.available ? 'success' : 'danger'">
              {{ item.available ? '可用' : '不可用' }}
            </Badge>
          </div>
          <p v-if="!store.capabilities" class="text-sm text-muted-foreground">
            正在检测 FFmpeg、FFprobe 和 sharp…
          </p>
        </div>
        <Button variant="secondary" size="sm" @click="store.refreshCapabilities">
          <RefreshCw class="size-3.5" />重新检测
        </Button>
      </section>
    </template>
  </div>
</template>
