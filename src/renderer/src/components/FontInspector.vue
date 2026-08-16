<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { FileSearch, FolderOpen, Grid3X3, Info, RotateCcw, Save, Search } from '@lucide/vue'
import type { FontEditValues, FontInspection, FontInspectionMetrics } from '../../../shared/types'
import { useAppStore } from '../stores/app'
import { fileName } from '../lib/utils'
import { filterFontCodePoints, formatUnicode } from '../lib/font-inspector'
import Button from './ui/Button.vue'

type TransformKey = 'offsetX' | 'offsetY' | 'scaleX' | 'scaleY' | 'skewX' | 'advanceWidthDelta'
type MetricKey = 'ascent' | 'descent' | 'lineGap' | 'xHeight' | 'capHeight'

interface TransformControl {
  key: TransformKey
  label: string
  unit: string
  min: number
  max: number
  step: number
}

const store = useAppStore()
const supportedExtensions = new Set(['ttf', 'otf', 'woff', 'woff2', 'ttc', 'otc'])
const inspection = ref<FontInspection | null>(null)
const edits = ref<FontEditValues | null>(null)
const loading = ref(false)
const saving = ref(false)
const searchQuery = ref('')
const fontFamily = ref('')
const previewError = ref('')
const saveNotice = ref('')
const gridViewport = ref<HTMLElement | null>(null)
const viewportWidth = ref(0)
const viewportHeight = ref(0)
const scrollTop = ref(0)
const cellSize = ref(104)
const scaleLinked = ref(true)
const showGrid = ref(true)
const showBaseline = ref(true)
const showMetrics = ref(true)
let loadedFace: FontFace | null = null
let resizeObserver: ResizeObserver | null = null

const transformControls = computed<TransformControl[]>(() => {
  const unitsPerEm = inspection.value?.metrics.unitsPerEm ?? 1000
  return [
    {
      key: 'offsetX',
      label: '水平位置',
      unit: 'units',
      min: -unitsPerEm,
      max: unitsPerEm,
      step: 1
    },
    {
      key: 'offsetY',
      label: '基线偏移',
      unit: 'units',
      min: -unitsPerEm,
      max: unitsPerEm,
      step: 1
    },
    { key: 'scaleX', label: '水平缩放', unit: '×', min: 0.5, max: 2, step: 0.01 },
    { key: 'scaleY', label: '垂直缩放', unit: '×', min: 0.5, max: 2, step: 0.01 },
    { key: 'skewX', label: '倾斜角度', unit: '°', min: -30, max: 30, step: 0.5 },
    {
      key: 'advanceWidthDelta',
      label: '额外字距',
      unit: 'units',
      min: -Math.round(unitsPerEm / 2),
      max: unitsPerEm,
      step: 1
    }
  ]
})

const metricControls = [
  { key: 'ascent', label: '上升部' },
  { key: 'descent', label: '下降部' },
  { key: 'lineGap', label: '行距' },
  { key: 'xHeight', label: 'x-height' },
  { key: 'capHeight', label: '大写高度' }
] satisfies Array<{ key: MetricKey; label: string }>

const filteredCodePoints = computed(() => {
  const source = inspection.value?.codePoints ?? []
  return filterFontCodePoints(source, searchQuery.value)
})
const columns = computed(() => Math.max(1, Math.floor(viewportWidth.value / cellSize.value)))
const rowCount = computed(() => Math.ceil(filteredCodePoints.value.length / columns.value))
const virtualHeight = computed(() => rowCount.value * cellSize.value)
const visibleItems = computed(() => {
  const firstRow = Math.max(0, Math.floor(scrollTop.value / cellSize.value) - 2)
  const visibleRows = Math.ceil(viewportHeight.value / cellSize.value) + 4
  const start = firstRow * columns.value
  const end = Math.min(filteredCodePoints.value.length, (firstRow + visibleRows) * columns.value)
  return filteredCodePoints.value.slice(start, end).map((codePoint, offset) => {
    const index = start + offset
    return {
      codePoint,
      character: String.fromCodePoint(codePoint),
      unicode: formatUnicode(codePoint),
      style: {
        left: `${(index % columns.value) * cellSize.value}px`,
        top: `${Math.floor(index / columns.value) * cellSize.value}px`,
        width: `${cellSize.value}px`,
        height: `${cellSize.value}px`
      }
    }
  })
})
const hasChanges = computed(() => {
  if (!inspection.value || !edits.value) return false
  return JSON.stringify(edits.value) !== JSON.stringify(initialEdits(inspection.value.metrics))
})
const glyphTransformStyle = computed(() => {
  const current = edits.value
  const metrics = inspection.value?.metrics
  if (!current || !metrics) return {}
  const fontSize = Math.max(26, cellSize.value * 0.5)
  const unitScale = fontSize / metrics.unitsPerEm
  return {
    fontFamily: `'${fontFamily.value}'`,
    fontSize: `${fontSize}px`,
    transform: `translate(calc(-50% + ${current.offsetX * unitScale}px), ${-current.offsetY * unitScale}px) scale(${current.scaleX}, ${current.scaleY}) skewX(${current.skewX}deg)`
  }
})

watch([filteredCodePoints, cellSize], () => {
  scrollTop.value = 0
  if (gridViewport.value) gridViewport.value.scrollTop = 0
})

async function chooseFont(): Promise<void> {
  try {
    const path = await window.api.selectFontForInspection()
    if (path) await loadFont(path)
  } catch (error) {
    store.errorMessage = friendlyError(error)
  }
}

async function openDroppedFiles(paths: string[]): Promise<void> {
  const fonts = paths.filter((path) => supportedExtensions.has(pathExtension(path)))
  if (fonts.length === 0) {
    store.errorMessage = '没有可检查的字体文件'
    return
  }
  if (fonts.length > 1) {
    store.errorMessage = '字体检查每次只能打开一个字体文件'
    return
  }
  await loadFont(fonts[0])
}

async function loadFont(path: string): Promise<void> {
  if (loading.value) return
  loading.value = true
  previewError.value = ''
  saveNotice.value = ''
  try {
    const result = await window.api.inspectFont(path)
    cleanupFontFace()
    const family = `vvtools-font-inspector-${crypto.randomUUID()}`
    const face = new FontFace(family, `url("${result.previewUrl}")`)
    try {
      await face.load()
      document.fonts.add(face)
      loadedFace = face
      fontFamily.value = family
    } catch {
      previewError.value = '字体信息已读取，但 Chromium 无法渲染该字体的预览'
      fontFamily.value = ''
    }
    inspection.value = result
    edits.value = initialEdits(result.metrics)
    searchQuery.value = ''
    await nextTick()
    observeViewport()
  } catch (error) {
    store.errorMessage = friendlyError(error)
  } finally {
    loading.value = false
  }
}

function setTransformValue(key: TransformKey, rawValue: string): void {
  if (!edits.value) return
  const value = Number(rawValue)
  if (!Number.isFinite(value)) return
  edits.value[key] = value
  if (scaleLinked.value && key === 'scaleX') edits.value.scaleY = value
  if (scaleLinked.value && key === 'scaleY') edits.value.scaleX = value
  saveNotice.value = ''
}

function setMetricValue(key: MetricKey, rawValue: string): void {
  if (!edits.value) return
  const value = Number(rawValue)
  if (!Number.isFinite(value)) return
  edits.value[key] = Math.round(value)
  saveNotice.value = ''
}

function resetEdits(): void {
  if (!inspection.value) return
  edits.value = initialEdits(inspection.value.metrics)
  saveNotice.value = '已恢复到本次打开字体时的状态'
}

async function saveFont(): Promise<void> {
  if (!inspection.value || !inspection.value.editable || !edits.value || saving.value) return
  saving.value = true
  saveNotice.value = ''
  try {
    const result = await window.api.saveEditedFont(inspection.value.sourcePath, edits.value)
    if (result) saveNotice.value = `已另存为 ${fileName(result.outputPath)}`
  } catch (error) {
    store.errorMessage = friendlyError(error)
  } finally {
    saving.value = false
  }
}

function observeViewport(): void {
  resizeObserver?.disconnect()
  if (!gridViewport.value) return
  resizeObserver = new ResizeObserver(([entry]) => {
    viewportWidth.value = entry.contentRect.width
    viewportHeight.value = entry.contentRect.height
  })
  resizeObserver.observe(gridViewport.value)
}

function onGridScroll(event: Event): void {
  scrollTop.value = (event.currentTarget as HTMLElement).scrollTop
}

function guidePosition(value: number): string {
  const current = edits.value
  if (!current) return '50%'
  const total = Math.max(1, current.ascent - current.descent)
  return `${Math.max(0, Math.min(100, ((current.ascent - value) / total) * 100))}%`
}

function initialEdits(metrics: FontInspectionMetrics): FontEditValues {
  return {
    ...metrics,
    offsetX: 0,
    offsetY: 0,
    scaleX: 1,
    scaleY: 1,
    skewX: 0,
    advanceWidthDelta: 0
  }
}

function pathExtension(path: string): string {
  return path.split('.').pop()?.toLowerCase() ?? ''
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': Error: /u, '')
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function cleanupFontFace(): void {
  if (loadedFace) document.fonts.delete(loadedFace)
  loadedFace = null
}

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  cleanupFontFace()
})

defineExpose({ openDroppedFiles })
</script>

<template>
  <div class="font-inspector">
    <section class="video-config-panel font-inspector-toolbar" aria-label="字体检查设置">
      <div class="video-config-heading">
        <div class="config-heading-main min-w-0">
          <FileSearch class="size-4 shrink-0 text-signal-strong" />
          <span class="shrink-0 text-sm font-semibold">字体检查</span>
          <span v-if="inspection" class="config-summary truncate text-xs text-muted-foreground">
            {{ inspection.fullName || inspection.familyName || inspection.fileName }} ·
            {{ inspection.codePoints.length.toLocaleString() }} 个字符
          </span>
        </div>
        <div class="video-config-actions">
          <Button variant="secondary" size="sm" :disabled="loading" @click="chooseFont">
            <FolderOpen class="size-4" />{{ inspection ? '更换字体' : '选择字体' }}
          </Button>
          <Button
            v-if="inspection"
            variant="ghost"
            size="sm"
            :disabled="!hasChanges"
            @click="resetEdits"
          >
            <RotateCcw class="size-4" />重置
          </Button>
          <Button
            v-if="inspection"
            size="sm"
            :disabled="!inspection.editable || !hasChanges || saving"
            @click="saveFont"
          >
            <Save class="size-4" />{{ saving ? '正在保存…' : '另存为新字体' }}
          </Button>
        </div>
      </div>
      <div v-if="inspection" class="font-inspector-facts" aria-label="字体概要">
        <span>{{ inspection.format.toUpperCase() }}</span>
        <span>{{ formatFileSize(inspection.fileSize) }}</span>
        <span>{{ inspection.glyphCount.toLocaleString() }} 个字形</span>
        <span>UPM {{ inspection.metrics.unitsPerEm }}</span>
        <span v-if="inspection.fontCount > 1">集合内 {{ inspection.fontCount }} 个字体</span>
        <span v-if="inspection.variationAxes.length">
          {{ inspection.variationAxes.length }} 个可变轴
        </span>
        <span v-if="inspection.readOnlyReason" class="font-inspector-readonly">
          {{ inspection.readOnlyReason }}
        </span>
      </div>
    </section>

    <div v-if="inspection && edits" class="font-inspector-content">
      <aside class="font-inspector-sidebar workspace-scroll-content" aria-label="字体信息与编辑">
        <section class="font-inspector-section">
          <h3>字体信息</h3>
          <dl class="font-inspector-details">
            <div>
              <dt>字体家族</dt>
              <dd>{{ inspection.familyName || '—' }}</dd>
            </div>
            <div>
              <dt>样式</dt>
              <dd>{{ inspection.subfamilyName || '—' }}</dd>
            </div>
            <div>
              <dt>PostScript</dt>
              <dd>{{ inspection.postscriptName || '—' }}</dd>
            </div>
            <div>
              <dt>版本</dt>
              <dd>{{ inspection.version || '—' }}</dd>
            </div>
          </dl>
          <div v-if="inspection.variationAxes.length" class="font-inspector-axes">
            <div v-for="axis in inspection.variationAxes" :key="axis.tag">
              <span>{{ axis.name }} ({{ axis.tag }})</span>
              <strong>{{ axis.min }} / {{ axis.default }} / {{ axis.max }}</strong>
            </div>
          </div>
        </section>

        <section class="font-inspector-section">
          <div class="font-inspector-section-heading">
            <h3>字形变换</h3>
            <label class="font-inspector-inline-check">
              <input v-model="scaleLinked" type="checkbox" />锁定缩放比例
            </label>
          </div>
          <div class="font-inspector-controls">
            <label v-for="control in transformControls" :key="control.key">
              <span>{{ control.label }}</span>
              <div class="font-inspector-control-row">
                <input
                  type="range"
                  :min="control.min"
                  :max="control.max"
                  :step="control.step"
                  :value="edits[control.key]"
                  @input="setTransformValue(control.key, ($event.target as HTMLInputElement).value)"
                />
                <input
                  type="number"
                  :min="control.min"
                  :max="control.max"
                  :step="control.step"
                  :value="edits[control.key]"
                  @input="setTransformValue(control.key, ($event.target as HTMLInputElement).value)"
                />
                <small>{{ control.unit }}</small>
              </div>
            </label>
          </div>
        </section>

        <section class="font-inspector-section">
          <h3>字体度量</h3>
          <div class="font-inspector-metrics">
            <label v-for="control in metricControls" :key="control.key">
              <span>{{ control.label }}</span>
              <input
                type="number"
                :value="edits[control.key]"
                @input="setMetricValue(control.key, ($event.target as HTMLInputElement).value)"
              />
            </label>
          </div>
          <p class="font-inspector-help">
            保存时会同步 hhea 与 OS/2 度量，并自动扩大 Windows 边界，避免字形被裁切。
          </p>
        </section>
      </aside>

      <section class="font-inspector-preview" aria-label="字符预览">
        <header class="font-inspector-preview-toolbar">
          <label class="font-inspector-search">
            <Search class="size-4" />
            <input v-model="searchQuery" placeholder="搜索字符或 Unicode，例如：汉、U+28FF" />
          </label>
          <span class="font-inspector-result-count">
            {{ filteredCodePoints.length.toLocaleString() }} /
            {{ inspection.codePoints.length.toLocaleString() }}
          </span>
          <label class="font-inspector-size-control">
            <Grid3X3 class="size-4" /><span>格子</span>
            <input v-model.number="cellSize" type="range" min="80" max="152" step="8" />
          </label>
          <label class="font-inspector-inline-check">
            <input v-model="showGrid" type="checkbox" />田字格
          </label>
          <label class="font-inspector-inline-check">
            <input v-model="showBaseline" type="checkbox" />基线
          </label>
          <label class="font-inspector-inline-check">
            <input v-model="showMetrics" type="checkbox" />度量线
          </label>
        </header>

        <div v-if="previewError" class="font-inspector-message" role="status">
          <Info class="size-4" />{{ previewError }}
        </div>
        <div v-else-if="saveNotice" class="font-inspector-message" role="status">
          <Info class="size-4" />{{ saveNotice }}
        </div>

        <div
          ref="gridViewport"
          class="font-inspector-grid-viewport"
          tabindex="0"
          @scroll="onGridScroll"
        >
          <div
            v-if="filteredCodePoints.length"
            class="font-inspector-grid-spacer"
            :style="{ height: `${virtualHeight}px` }"
          >
            <article
              v-for="item in visibleItems"
              :key="item.codePoint"
              class="font-inspector-cell"
              :class="{ 'font-inspector-cell-grid': showGrid }"
              :style="item.style"
            >
              <div class="font-inspector-glyph-area">
                <span
                  v-if="showMetrics"
                  class="font-guide font-guide-ascent"
                  :style="{ top: guidePosition(edits.ascent) }"
                />
                <span
                  v-if="showMetrics"
                  class="font-guide font-guide-cap"
                  :style="{ top: guidePosition(edits.capHeight) }"
                />
                <span
                  v-if="showMetrics"
                  class="font-guide font-guide-x"
                  :style="{ top: guidePosition(edits.xHeight) }"
                />
                <span
                  v-if="showBaseline"
                  class="font-guide font-guide-baseline"
                  :style="{ top: guidePosition(0) }"
                />
                <span
                  v-if="showMetrics"
                  class="font-guide font-guide-descent"
                  :style="{ top: guidePosition(edits.descent) }"
                />
                <span v-if="fontFamily" class="font-inspector-glyph" :style="glyphTransformStyle">{{
                  item.character
                }}</span>
              </div>
              <footer>
                <span>{{ item.character }}</span
                ><code>{{ item.unicode }}</code>
              </footer>
            </article>
          </div>
          <div v-else class="font-inspector-empty-search">
            <Search class="size-7" />
            <strong>没有找到字体已包含的字符</strong>
            <span>检查输入的字符或 Unicode；缺失字符不会显示。</span>
          </div>
        </div>
      </section>
    </div>

    <div v-else class="video-workspace-content workspace-scroll-content">
      <div class="video-drop-prompt">
        <div class="video-drop-icon"><FileSearch class="size-8" /></div>
        <p class="text-lg font-semibold">选择一个字体进行检查</p>
        <p class="mt-1 max-w-xl text-center text-sm text-muted-foreground">
          查看全部字符和字体度量，搜索实际包含的字形，并在田字格中预览全局调整。
        </p>
        <Button class="mt-5" :disabled="loading" @click="chooseFont">
          {{ loading ? '正在读取…' : '选择字体文件' }}
        </Button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.font-inspector {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}

.font-inspector-toolbar {
  flex: none;
}

.font-inspector-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  padding-top: 10px;
  color: var(--muted-foreground);
  font-size: 11px;
}

.font-inspector-readonly {
  color: var(--warning-fg);
}

.font-inspector-content {
  display: grid;
  min-height: 0;
  flex: 1;
  grid-template-columns: minmax(260px, 320px) minmax(0, 1fr);
  gap: 8px;
  padding-top: 8px;
}

.font-inspector-sidebar,
.font-inspector-preview {
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--background);
}

.font-inspector-sidebar {
  overflow: auto;
  padding: 16px;
}

.font-inspector-section + .font-inspector-section {
  margin-top: 22px;
  padding-top: 20px;
  border-top: 1px solid var(--border);
}

.font-inspector-section h3 {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 650;
}

.font-inspector-section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.font-inspector-details {
  display: grid;
  gap: 8px;
  margin: 0;
}

.font-inspector-details div,
.font-inspector-axes div {
  display: grid;
  grid-template-columns: 84px minmax(0, 1fr);
  gap: 8px;
}

.font-inspector-details dt,
.font-inspector-axes span {
  color: var(--muted-foreground);
  font-size: 11px;
}

.font-inspector-details dd,
.font-inspector-axes strong {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 11px;
  font-weight: 500;
}

.font-inspector-axes {
  display: grid;
  gap: 6px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.font-inspector-inline-check {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--muted-foreground);
  font-size: 11px;
  white-space: nowrap;
}

.font-inspector-inline-check input {
  accent-color: var(--primary);
}

.font-inspector-controls {
  display: grid;
  gap: 12px;
}

.font-inspector-controls > label > span,
.font-inspector-metrics label span {
  display: block;
  margin-bottom: 5px;
  color: var(--muted-foreground);
  font-size: 11px;
  font-weight: 600;
}

.font-inspector-control-row {
  display: grid;
  grid-template-columns: minmax(70px, 1fr) 72px 32px;
  align-items: center;
  gap: 6px;
}

.font-inspector-control-row input[type='range'],
.font-inspector-size-control input {
  min-width: 0;
  accent-color: var(--primary);
}

.font-inspector-control-row input[type='number'],
.font-inspector-metrics input {
  width: 100%;
  height: 30px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--background);
  color: var(--foreground);
  padding: 0 7px;
  font-size: 11px;
}

.font-inspector-control-row small {
  color: var(--muted-foreground);
  font-size: 10px;
}

.font-inspector-metrics {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 8px;
}

.font-inspector-help {
  margin: 10px 0 0;
  color: var(--muted-foreground);
  font-size: 10px;
  line-height: 1.5;
}

.font-inspector-preview {
  display: flex;
  overflow: hidden;
  flex-direction: column;
}

.font-inspector-preview-toolbar {
  display: flex;
  min-height: 48px;
  flex: none;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-bottom: 1px solid var(--border);
}

.font-inspector-search {
  display: flex;
  min-width: 180px;
  height: 34px;
  flex: 1;
  align-items: center;
  gap: 7px;
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 0 9px;
  color: var(--muted-foreground);
}

.font-inspector-search:focus-within {
  border-color: var(--ring);
  box-shadow: 0 0 0 3px var(--focus-ring);
}

.font-inspector-search input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--foreground);
  font-size: 12px;
}

.font-inspector-result-count {
  color: var(--muted-foreground);
  font-size: 10px;
  white-space: nowrap;
}

.font-inspector-size-control {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--muted-foreground);
  font-size: 11px;
}

.font-inspector-size-control input {
  width: 70px;
}

.font-inspector-message {
  display: flex;
  flex: none;
  align-items: center;
  gap: 7px;
  padding: 7px 11px;
  border-bottom: 1px solid var(--border);
  background: var(--info-bg);
  color: var(--info-fg);
  font-size: 11px;
}

.font-inspector-grid-viewport {
  position: relative;
  min-height: 0;
  flex: 1;
  overflow: auto;
  outline: none;
}

.font-inspector-grid-viewport:focus-visible {
  box-shadow: inset 0 0 0 3px var(--focus-ring);
}

.font-inspector-grid-spacer {
  position: relative;
  min-width: 100%;
}

.font-inspector-cell {
  position: absolute;
  overflow: hidden;
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  background: var(--background);
}

.font-inspector-glyph-area {
  position: relative;
  height: calc(100% - 23px);
  overflow: hidden;
}

.font-inspector-cell-grid .font-inspector-glyph-area::before,
.font-inspector-cell-grid .font-inspector-glyph-area::after {
  position: absolute;
  z-index: 0;
  content: '';
  opacity: 0.7;
  pointer-events: none;
}

.font-inspector-cell-grid .font-inspector-glyph-area::before {
  top: 0;
  bottom: 0;
  left: 50%;
  border-left: 1px dashed var(--border);
}

.font-inspector-cell-grid .font-inspector-glyph-area::after {
  top: 50%;
  right: 0;
  left: 0;
  border-top: 1px dashed var(--border);
}

.font-guide {
  position: absolute;
  right: 0;
  left: 0;
  z-index: 1;
  border-top: 1px solid color-mix(in srgb, var(--muted-foreground) 35%, transparent);
  pointer-events: none;
}

.font-guide-x {
  border-top-style: dotted;
}

.font-guide-baseline {
  border-color: color-mix(in srgb, var(--primary) 62%, transparent);
}

.font-inspector-glyph {
  position: absolute;
  top: 24%;
  left: 50%;
  z-index: 2;
  display: block;
  color: var(--foreground);
  line-height: 1;
  transform-origin: center 72%;
  white-space: nowrap;
}

.font-inspector-cell footer {
  display: flex;
  height: 23px;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  padding: 0 6px;
  border-top: 1px solid var(--border);
  background: var(--surface-raised);
  color: var(--muted-foreground);
  font-size: 10px;
}

.font-inspector-cell footer code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
}

.font-inspector-empty-search {
  display: flex;
  height: 100%;
  min-height: 240px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 7px;
  color: var(--muted-foreground);
  text-align: center;
}

.font-inspector-empty-search strong {
  color: var(--foreground);
  font-size: 13px;
}

.font-inspector-empty-search span {
  font-size: 11px;
}

@media (max-width: 1120px) {
  .font-inspector-content {
    grid-template-columns: 270px minmax(0, 1fr);
  }

  .font-inspector-preview-toolbar {
    flex-wrap: wrap;
  }

  .font-inspector-search {
    flex-basis: 100%;
  }
}
</style>
