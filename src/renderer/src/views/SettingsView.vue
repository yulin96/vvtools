<script setup lang="ts">
import { Cpu, FileOutput, RefreshCw } from '@lucide/vue'
import type { AppSettings, TaskKind } from '../../../shared/types'
import { useAppStore } from '../stores/app'
import OutputConflictPolicyField from '../components/OutputConflictPolicyField.vue'
import OutputSuffixField from '../components/OutputSuffixField.vue'
import Badge from '../components/ui/Badge.vue'
import Button from '../components/ui/Button.vue'
import SegmentedControl from '../components/ui/SegmentedControl.vue'

const store = useAppStore()
const concurrencyModeOptions = [
  { value: 'auto', label: '自动调度', title: '根据任务类型和处理器核心数分配并发' },
  { value: 'custom', label: '自定义', title: '分别设置图片、视频、音频、PDF 和字体并发数' }
]
const closeBehaviorOptions = [
  { value: 'ask', label: '每次询问', title: '关闭时询问继续后台处理还是取消任务' },
  { value: 'minimizeToTray', label: '后台继续', title: '关闭窗口后继续处理任务' },
  { value: 'quit', label: '取消并退出', title: '关闭窗口时取消任务并退出应用' }
]
const concurrencyOptions: Record<TaskKind, number> = {
  image: 8,
  video: 2,
  audio: 4,
  pdf: 2,
  font: 1
}
const concurrencyKinds = ['image', 'video', 'audio', 'pdf', 'font'] as const
const concurrencyLabels: Record<TaskKind, string> = {
  image: '同时处理的图片数',
  video: '同时处理的视频数',
  audio: '同时处理的音频数',
  pdf: '同时处理的 PDF 数',
  font: '同时处理的字体数'
}

function capabilityLabel(name: string): string {
  return (
    {
      ffmpeg: 'FFmpeg',
      ffprobe: 'FFprobe',
      sharp: 'sharp',
      hardwareVideo: '硬件视频编码',
      pdfium: 'PDFium',
      qpdf: 'qpdf',
      fonttools: 'FontTools'
    }[name] ?? name
  )
}

function updateConcurrencyMode(value: string | number): void {
  if (!store.settings) return
  void store.updateSettings({
    common: {
      concurrency: {
        ...store.settings.common.concurrency,
        mode: value as AppSettings['common']['concurrency']['mode']
      }
    }
  })
}

function updateConcurrencyLimit(kind: TaskKind, event: Event): void {
  if (!store.settings) return
  void store.updateSettings({
    common: {
      concurrency: {
        ...store.settings.common.concurrency,
        custom: {
          ...store.settings.common.concurrency.custom,
          [kind]: Number((event.target as HTMLSelectElement).value)
        }
      }
    }
  })
}

function updateCloseBehavior(value: string | number): void {
  void store.updateSettings({
    common: {
      closeBehavior: value as AppSettings['common']['closeBehavior']
    }
  })
}

function updateOutputNameTemplate(event: Event): void {
  if (!store.settings) return
  const target = event.target as HTMLInputElement
  const template = target.value.trim()
  const literals = template.replace(
    /\{(?:name|suffix|preset|width|height|page|index|instance|date)\}/gu,
    ''
  )
  const invalidLiteral = [...literals].some(
    (character) => character.charCodeAt(0) < 32 || '<>:"/\\|?*{}'.includes(character)
  )
  if (!template || template.length > 100 || !template.includes('{name}') || invalidLiteral) {
    store.errorMessage = '文件名规则必须包含 {name}，且只能使用受支持的变量'
    target.value = store.settings.common.outputNameTemplate
    return
  }
  void store.updateSettings({ common: { outputNameTemplate: template } })
}

</script>

<template>
  <div class="page-container">
    <header class="page-header">
      <div>
        <h1>设置</h1>
        <p>管理适用于所有处理页面的输出规则、任务调度和应用行为。</p>
      </div>
    </header>
    <template v-if="store.settings">
      <div class="settings-group-heading">
        <span>通用</span>
        <p>这里的修改会同时影响图片、视频、音频、PDF 和字体任务。</p>
      </div>

      <section class="settings-card settings-card-stack">
        <div class="settings-card-title">
          <Cpu class="size-4" />
          <div>
            <h2>任务调度</h2>
            <p>自动模式会根据任务类型分配并发，避免视频任务占满处理器。</p>
          </div>
        </div>
        <div class="settings-card-controls settings-concurrency-controls">
          <div class="settings-scheduling-row">
            <SegmentedControl
              class="w-72"
              label="同时处理数量"
              :model-value="store.settings.common.concurrency.mode"
              :options="concurrencyModeOptions"
              @update:model-value="updateConcurrencyMode"
            />
            <p
              v-if="store.settings.common.concurrency.mode === 'auto'"
              class="settings-inline-note"
            >
              图片会按 CPU 核心数自动分配，最高 8 个；视频、PDF 和字体各使用 1 个；音频最高 2 个。
            </p>
          </div>
          <div
            v-if="store.settings.common.concurrency.mode === 'custom'"
            class="settings-concurrency-custom"
          >
            <label v-for="kind in concurrencyKinds" :key="kind" class="field-label">
              <span>{{ concurrencyLabels[kind] }}</span>
              <select
                :value="store.settings.common.concurrency.custom[kind]"
                class="field-control"
                @change="updateConcurrencyLimit(kind, $event)"
              >
                <option v-for="value in concurrencyOptions[kind]" :key="value" :value="value">
                  {{ value }}
                </option>
              </select>
            </label>
          </div>
          <div class="settings-close-behavior-row">
            <SegmentedControl
              class="settings-close-behavior-control"
              label="有任务时关闭窗口"
              :model-value="store.settings.common.closeBehavior"
              :options="closeBehaviorOptions"
              @update:model-value="updateCloseBehavior"
            />
          </div>
        </div>
      </section>

      <section class="settings-card">
        <div class="settings-card-title">
          <FileOutput class="size-4" />
          <div>
            <h2>文件与输出</h2>
            <p>统一设置文件名和同名文件处理方式。</p>
          </div>
        </div>
        <div class="settings-card-controls settings-output-controls">
          <OutputSuffixField />
          <OutputConflictPolicyField />
          <label class="field-label settings-template-field">
            <span>文件名规则</span>
            <input
              :value="store.settings.common.outputNameTemplate"
              class="field-control font-mono"
              maxlength="100"
              @change="updateOutputNameTemplate"
            />
            <span class="text-[11px] text-muted-foreground">
              可用：{name} {suffix} {preset} {width} {height} {page} {index} {instance}
              {date}。模板必须包含 {name}。
            </span>
          </label>
        </div>
      </section>

      <div class="settings-group-heading">
        <span>应用</span>
        <p>版本更新和本机处理组件状态。</p>
      </div>

      <section class="settings-card">
        <div class="settings-card-title">
          <RefreshCw class="size-4" />
          <div>
            <h2>软件更新</h2>
            <p>{{ store.updateDescription }}</p>
            <div
              v-if="store.updateState.status === 'downloading'"
              class="mt-2 h-1.5 w-64 overflow-hidden rounded-full bg-muted"
            >
              <div
                class="h-full rounded-full bg-primary transition-[width]"
                :style="{
                  width: `${Math.min(100, Math.max(0, store.updateState.percent ?? 0))}%`
                }"
              />
            </div>
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          :disabled="
            store.updateState.status === 'checking' || store.updateState.status === 'downloading'
          "
          @click="store.requestUpdateAction"
        >
          <RefreshCw
            class="size-3.5"
            :class="{ 'animate-spin': store.updateState.status === 'checking' }"
          />
          {{ store.updateButtonLabel }}
        </Button>
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
            正在检测 FFmpeg、FFprobe、PDFium、qpdf、FontTools 和 sharp…
          </p>
        </div>
        <Button variant="secondary" size="sm" @click="store.refreshCapabilities">
          <RefreshCw class="size-3.5" />重新检测
        </Button>
      </section>
    </template>
  </div>
</template>
