<script setup lang="ts">
import { computed, ref } from 'vue'
import { FileImage, Film, FolderOpen, Plus, UploadCloud } from '@lucide/vue'
import type { ImageFormat, TaskKind, VideoQuality, VideoResolution } from '../../../shared/types'
import { useAppStore } from '../stores/app'
import Button from '../components/ui/Button.vue'
import TaskTable from '../components/TaskTable.vue'

const props = defineProps<{ kind: TaskKind }>()
const store = useAppStore()
const dragging = ref(false)

const isVideo = computed(() => props.kind === 'video')
const title = computed(() => (isVideo.value ? '视频压缩' : '图片压缩'))
const description = computed(() =>
  isVideo.value
    ? '批量转换为兼容性优先的 MP4（H.264 + AAC）。'
    : '批量压缩图片，并可转换为 JPEG、PNG 或 WebP。'
)
const recentTasks = computed(() => store.tasks.filter((task) => task.kind === props.kind).slice(-8))

async function enqueue(paths: string[]): Promise<void> {
  if (!store.settings || paths.length === 0) return
  const uniquePaths = [...new Set(paths)]
  if (isVideo.value) {
    await store.createTasks({
      kind: 'video',
      sourcePaths: uniquePaths,
      outputDirectory: store.settings.outputDirectory,
      options: { ...store.settings.video }
    })
  } else {
    await store.createTasks({
      kind: 'image',
      sourcePaths: uniquePaths,
      outputDirectory: store.settings.outputDirectory,
      options: { ...store.settings.image }
    })
  }
}

async function chooseFiles(): Promise<void> {
  await enqueue(await window.api.selectFiles(props.kind))
}

async function chooseOutput(): Promise<void> {
  if (!store.settings) return
  const path = await window.api.selectOutputDirectory(store.settings.outputDirectory)
  if (path) await store.updateSettings({ outputDirectory: path })
}

async function handleDrop(event: DragEvent): Promise<void> {
  dragging.value = false
  const files = [...(event.dataTransfer?.files || [])]
  const extensions = isVideo.value
    ? new Set(['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'mpeg', 'mpg'])
    : new Set(['jpg', 'jpeg', 'png', 'webp'])
  const paths = files
    .map((file) => window.api.getDroppedFilePath(file))
    .filter((path) => extensions.has(path.split('.').pop()?.toLowerCase() || ''))
  if (paths.length === 0 && files.length > 0) {
    store.errorMessage = `没有可导入的${isVideo.value ? '视频' : '图片'}文件`
    return
  }
  await enqueue(paths)
}

function updateVideoQuality(value: Event): void {
  if (!store.settings) return
  void store.updateSettings({
    video: {
      ...store.settings.video,
      quality: (value.target as HTMLSelectElement).value as VideoQuality
    }
  })
}

function updateVideoResolution(value: Event): void {
  if (!store.settings) return
  void store.updateSettings({
    video: {
      ...store.settings.video,
      resolution: (value.target as HTMLSelectElement).value as VideoResolution
    }
  })
}

function updateImageQuality(value: Event): void {
  if (!store.settings) return
  void store.updateSettings({
    image: { ...store.settings.image, quality: Number((value.target as HTMLInputElement).value) }
  })
}

function updateImageFormat(value: Event): void {
  if (!store.settings) return
  void store.updateSettings({
    image: {
      ...store.settings.image,
      format: (value.target as HTMLSelectElement).value as ImageFormat
    }
  })
}
</script>

<template>
  <div class="page-container">
    <header class="page-header">
      <div>
        <h1>{{ title }}</h1>
        <p>{{ description }}</p>
      </div>
      <Button variant="secondary" @click="chooseOutput">
        <FolderOpen class="size-4" />
        选择输出目录
      </Button>
    </header>

    <template v-if="store.settings">
      <section class="settings-strip">
        <div v-if="isVideo" class="settings-grid">
          <label class="field-label">
            <span>视频质量</span>
            <select
              :value="store.settings.video.quality"
              class="field-control"
              @change="updateVideoQuality"
            >
              <option value="high">高质量 · CRF 20</option>
              <option value="balanced">均衡 · CRF 23</option>
              <option value="small">更小体积 · CRF 28</option>
            </select>
          </label>
          <label class="field-label">
            <span>输出分辨率</span>
            <select
              :value="store.settings.video.resolution"
              class="field-control"
              @change="updateVideoResolution"
            >
              <option value="source">保持原始</option>
              <option value="1080p">最高 1080p</option>
              <option value="720p">最高 720p</option>
            </select>
          </label>
          <div class="field-label min-w-0 flex-1">
            <span>输出目录</span>
            <p class="path-field" :title="store.settings.outputDirectory">
              {{ store.settings.outputDirectory }}
            </p>
          </div>
        </div>
        <div v-else class="settings-grid">
          <label class="field-label min-w-[240px]">
            <span>图片质量 · {{ store.settings.image.quality }}</span>
            <input
              type="range"
              min="1"
              max="100"
              :value="store.settings.image.quality"
              class="mt-2 w-full accent-[var(--signal)]"
              @change="updateImageQuality"
            />
          </label>
          <label class="field-label">
            <span>输出格式</span>
            <select
              :value="store.settings.image.format"
              class="field-control"
              @change="updateImageFormat"
            >
              <option value="original">保持原格式</option>
              <option value="jpeg">JPEG</option>
              <option value="png">PNG</option>
              <option value="webp">WebP</option>
            </select>
          </label>
          <div class="field-label min-w-0 flex-1">
            <span>输出目录</span>
            <p class="path-field" :title="store.settings.outputDirectory">
              {{ store.settings.outputDirectory }}
            </p>
          </div>
        </div>
      </section>

      <section
        class="drop-zone"
        :class="{ 'drop-zone-active': dragging }"
        @dragenter.prevent="dragging = true"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="handleDrop"
      >
        <div class="drop-icon"><UploadCloud class="size-6" /></div>
        <div>
          <h2>拖拽{{ isVideo ? '视频' : '图片' }}文件到这里</h2>
          <p>也可以点击按钮选择多个文件，导入后会立即进入任务队列。</p>
        </div>
        <Button @click="chooseFiles"><Plus class="size-4" />选择文件</Button>
      </section>

      <section>
        <div class="section-heading">
          <div class="flex items-center gap-2">
            <component :is="isVideo ? Film : FileImage" class="size-4 text-signal" />
            <h2>最近任务</h2>
          </div>
        </div>
        <TaskTable :tasks="recentTasks" :empty-text="`尚未添加${isVideo ? '视频' : '图片'}任务`" />
      </section>
    </template>
  </div>
</template>
