<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  ChevronDown,
  ChevronUp,
  FileVideo2,
  FolderOpen,
  SlidersHorizontal,
  UploadCloud
} from '@lucide/vue'
import type {
  VideoAudioMode,
  VideoCodec,
  VideoFormat,
  VideoFrameRate,
  VideoOptions,
  VideoOutputMode,
  VideoQuality,
  VideoRateControl,
  VideoResolution
} from '../../../shared/types'
import { useAppStore } from '../stores/app'
import Button from '../components/ui/Button.vue'

const store = useAppStore()
const configExpanded = ref(false)
const dragging = ref(false)
const videoExtensions = new Set(['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'mpeg', 'mpg'])

const qualityLabel = computed(() => {
  if (!store.settings) return ''
  if (store.settings.video.rateControl === 'bitrate') {
    return `${store.settings.video.bitrateMbps} Mbps`
  }
  return { high: '高质量', balanced: '均衡', small: '更小体积' }[store.settings.video.quality]
})

function updateVideo(patch: Partial<VideoOptions>): void {
  if (!store.settings) return
  void store.updateSettings({ video: { ...store.settings.video, ...patch } })
}

async function updateOutputMode(event: Event): Promise<void> {
  const videoOutputMode = (event.target as HTMLSelectElement).value as VideoOutputMode
  await store.updateSettings({ videoOutputMode })
}

async function chooseOutput(): Promise<void> {
  if (!store.settings) return
  const path = await window.api.selectOutputDirectory(store.settings.outputDirectory)
  if (path) {
    await store.updateSettings({ outputDirectory: path, videoOutputMode: 'custom' })
  }
}

async function enqueue(paths: string[]): Promise<void> {
  if (!store.settings || paths.length === 0) return
  await store.createTasks({
    kind: 'video',
    sourcePaths: [...new Set(paths)],
    outputMode: store.settings.videoOutputMode,
    outputDirectory:
      store.settings.videoOutputMode === 'custom' ? store.settings.outputDirectory : undefined,
    options: { ...store.settings.video }
  })
}

async function chooseFiles(): Promise<void> {
  await enqueue(await window.api.selectFiles('video'))
}

function hasFiles(event: DragEvent): boolean {
  return [...(event.dataTransfer?.types || [])].includes('Files')
}

function handleDragOver(event: DragEvent): void {
  if (!hasFiles(event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  dragging.value = true
}

function handleDragLeave(event: DragEvent): void {
  if (!event.relatedTarget) dragging.value = false
}

function handleDrop(event: DragEvent): void {
  if (!hasFiles(event)) return
  event.preventDefault()
  dragging.value = false
  const files = [...(event.dataTransfer?.files || [])]
  const paths = files
    .map((file) => window.api.getDroppedFilePath(file))
    .filter((path) => videoExtensions.has(path.split('.').pop()?.toLowerCase() || ''))
  if (paths.length === 0 && files.length > 0) {
    store.errorMessage = '没有可导入的视频文件'
    return
  }
  void enqueue(paths)
}

onMounted(() => {
  window.addEventListener('dragover', handleDragOver, true)
  window.addEventListener('dragleave', handleDragLeave, true)
  window.addEventListener('drop', handleDrop, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('dragover', handleDragOver, true)
  window.removeEventListener('dragleave', handleDragLeave, true)
  window.removeEventListener('drop', handleDrop, true)
})
</script>

<template>
  <div class="video-drop-workspace" :class="{ 'video-drop-workspace-active': dragging }">
    <section v-if="store.settings" class="video-config-panel" aria-label="视频转换设置">
      <div class="video-config-heading">
        <div class="flex min-w-0 items-center gap-2">
          <SlidersHorizontal class="size-4 text-signal-strong" />
          <span class="text-sm font-semibold">视频设置</span>
          <span class="truncate text-xs text-muted-foreground">
            {{ store.settings.video.format.toUpperCase() }} ·
            {{ store.settings.video.codec === 'h264' ? 'H.264' : 'H.265' }} ·
            {{ qualityLabel }}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          :aria-expanded="configExpanded"
          @click="configExpanded = !configExpanded"
        >
          {{ configExpanded ? '收起' : '更多设置' }}
          <component :is="configExpanded ? ChevronUp : ChevronDown" class="size-3.5" />
        </Button>
      </div>

      <div class="video-config-primary">
        <label class="compact-field">
          <span>格式</span>
          <select
            :value="store.settings.video.format"
            @change="
              updateVideo({ format: ($event.target as HTMLSelectElement).value as VideoFormat })
            "
          >
            <option value="mp4">MP4</option>
            <option value="mov">MOV</option>
            <option value="mkv">MKV</option>
          </select>
        </label>
        <label class="compact-field">
          <span>分辨率</span>
          <select
            :value="store.settings.video.resolution"
            @change="
              updateVideo({
                resolution: ($event.target as HTMLSelectElement).value as VideoResolution
              })
            "
          >
            <option value="source">保持原始</option>
            <option value="1080p">最高 1080p</option>
            <option value="720p">最高 720p</option>
          </select>
        </label>
        <label class="compact-field">
          <span>压缩方式</span>
          <select
            :value="store.settings.video.rateControl"
            @change="
              updateVideo({
                rateControl: ($event.target as HTMLSelectElement).value as VideoRateControl
              })
            "
          >
            <option value="quality">按质量</option>
            <option value="bitrate">目标码率</option>
          </select>
        </label>
        <label v-if="store.settings.video.rateControl === 'quality'" class="compact-field">
          <span>质量</span>
          <select
            :value="store.settings.video.quality"
            @change="
              updateVideo({ quality: ($event.target as HTMLSelectElement).value as VideoQuality })
            "
          >
            <option value="high">高质量</option>
            <option value="balanced">均衡</option>
            <option value="small">更小体积</option>
          </select>
        </label>
        <label v-else class="compact-field">
          <span>视频码率</span>
          <div class="number-field">
            <input
              :value="store.settings.video.bitrateMbps"
              type="number"
              min="0.5"
              max="100"
              step="0.5"
              @change="
                updateVideo({ bitrateMbps: Number(($event.target as HTMLInputElement).value) })
              "
            /><span>Mbps</span>
          </div>
        </label>
        <label class="compact-field">
          <span>输出到</span>
          <select :value="store.settings.videoOutputMode" @change="updateOutputMode">
            <option value="source">源文件当前目录</option>
            <option value="custom">指定目录</option>
          </select>
        </label>
      </div>

      <div v-if="store.settings.videoOutputMode === 'custom'" class="video-config-directory">
        <span>指定输出目录</span>
        <button
          class="directory-picker"
          type="button"
          :title="store.settings.outputDirectory"
          @click="chooseOutput"
        >
          <span>{{ store.settings.outputDirectory }}</span>
          <FolderOpen class="size-4 shrink-0" />
        </button>
      </div>

      <div v-if="configExpanded" class="video-config-expanded">
        <label class="compact-field">
          <span>视频编码</span>
          <select
            :value="store.settings.video.codec"
            @change="
              updateVideo({ codec: ($event.target as HTMLSelectElement).value as VideoCodec })
            "
          >
            <option value="h264">H.264 · 兼容优先</option>
            <option value="h265">H.265 · 更小体积</option>
          </select>
        </label>
        <label class="compact-field">
          <span>帧率</span>
          <select
            :value="store.settings.video.frameRate"
            @change="
              updateVideo({
                frameRate: ($event.target as HTMLSelectElement).value as VideoFrameRate
              })
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
            :value="store.settings.video.audioMode"
            @change="
              updateVideo({
                audioMode: ($event.target as HTMLSelectElement).value as VideoAudioMode
              })
            "
          >
            <option value="aac">转为 AAC</option>
            <option value="copy">复制原音频</option>
            <option value="none">移除音频</option>
          </select>
        </label>
        <label
          class="compact-field"
          :class="{ 'opacity-45': store.settings.video.audioMode !== 'aac' }"
        >
          <span>音频码率</span>
          <select
            :value="store.settings.video.audioBitrateKbps"
            :disabled="store.settings.video.audioMode !== 'aac'"
            @change="
              updateVideo({ audioBitrateKbps: Number(($event.target as HTMLSelectElement).value) })
            "
          >
            <option :value="96">96 kbps</option>
            <option :value="128">128 kbps</option>
            <option :value="192">192 kbps</option>
            <option :value="256">256 kbps</option>
          </select>
        </label>
      </div>
    </section>

    <div class="video-drop-prompt" :class="{ 'video-drop-prompt-active': dragging }">
      <div class="video-drop-icon">
        <UploadCloud v-if="dragging" class="size-8" />
        <FileVideo2 v-else class="size-8" />
      </div>
      <p class="text-lg font-semibold">{{ dragging ? '松开即可添加视频' : '拖入视频文件' }}</p>
      <p class="mt-1 text-sm text-muted-foreground">支持 MP4、MOV、MKV、AVI、WebM 等常见格式</p>
      <Button class="mt-5" @click="chooseFiles">选择视频文件</Button>
    </div>
  </div>
</template>
