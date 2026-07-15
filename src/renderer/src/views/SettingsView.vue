<script setup lang="ts">
import { Cpu, Image, RefreshCw, Video } from '@lucide/vue'
import type { AppSettings } from '../../../shared/types'
import { useAppStore } from '../stores/app'
import Badge from '../components/ui/Badge.vue'
import Button from '../components/ui/Button.vue'

const store = useAppStore()

function updateConcurrency(event: Event): void {
  void store.updateSettings({ concurrency: Number((event.target as HTMLSelectElement).value) })
}

function updateNested<K extends 'video' | 'image'>(key: K, patch: Partial<AppSettings[K]>): void {
  if (!store.settings) return
  void store.updateSettings({ [key]: { ...store.settings[key], ...patch } })
}
</script>

<template>
  <div class="page-container">
    <header class="page-header">
      <div>
        <h1>基础设置</h1>
        <p>这些参数会作为新任务的默认值，不影响已加入队列的任务。</p>
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
        <label class="field-label w-56"
          ><span>并发数</span
          ><select
            :value="store.settings.concurrency"
            class="field-control"
            @change="updateConcurrency"
          >
            <option v-for="value in 4" :key="value" :value="value">
              {{ value }}{{ value === 1 ? '（推荐）' : '' }}
            </option>
          </select></label
        >
      </section>
      <section class="settings-card">
        <div class="settings-card-title">
          <Video class="size-4" />
          <div>
            <h2>视频默认参数</h2>
            <p>统一输出 MP4、H.264 和 AAC。</p>
          </div>
        </div>
        <div class="flex flex-wrap gap-4">
          <label class="field-label w-56"
            ><span>质量</span
            ><select
              :value="store.settings.video.quality"
              class="field-control"
              @change="
                updateNested('video', {
                  quality: ($event.target as HTMLSelectElement)
                    .value as AppSettings['video']['quality']
                })
              "
            >
              <option value="high">高质量</option>
              <option value="balanced">均衡</option>
              <option value="small">更小体积</option>
            </select></label
          >
          <label class="field-label w-56"
            ><span>分辨率</span
            ><select
              :value="store.settings.video.resolution"
              class="field-control"
              @change="
                updateNested('video', {
                  resolution: ($event.target as HTMLSelectElement)
                    .value as AppSettings['video']['resolution']
                })
              "
            >
              <option value="source">保持原始</option>
              <option value="1080p">最高 1080p</option>
              <option value="720p">最高 720p</option>
            </select></label
          >
        </div>
      </section>
      <section class="settings-card">
        <div class="settings-card-title">
          <Image class="size-4" />
          <div>
            <h2>图片默认参数</h2>
            <p>保持原尺寸并自动纠正图片方向。</p>
          </div>
        </div>
        <div class="flex flex-wrap gap-4">
          <label class="field-label w-56"
            ><span>质量</span
            ><input
              type="number"
              min="1"
              max="100"
              :value="store.settings.image.quality"
              class="field-control"
              @change="
                updateNested('image', {
                  quality: Number(($event.target as HTMLInputElement).value)
                })
              "
          /></label>
          <label class="field-label w-56"
            ><span>格式</span
            ><select
              :value="store.settings.image.format"
              class="field-control"
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
            </select></label
          >
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
              <p class="text-sm font-medium uppercase">{{ name }}</p>
              <p class="truncate text-xs text-muted-foreground" :title="item.version || item.error">
                {{ item.version || item.error || '正在检测…' }}
              </p>
            </div>
            <Badge :tone="item.available ? 'success' : 'danger'">{{
              item.available ? '可用' : '不可用'
            }}</Badge>
          </div>
          <p v-if="!store.capabilities" class="text-sm text-muted-foreground">
            正在检测 FFmpeg、FFprobe 和 sharp…
          </p>
        </div>
        <Button variant="secondary" size="sm" @click="store.refreshCapabilities"
          ><RefreshCw class="size-3.5" />重新检测</Button
        >
      </section>
    </template>
  </div>
</template>
