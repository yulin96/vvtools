<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Images,
  Download,
  FileText,
  Monitor,
  Moon,
  Music,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sun,
  Type,
  Video,
  X
} from '@lucide/vue'
import { useRoute } from 'vue-router'
import { useAppStore } from './stores/app'
import appIcon from '../../../resources/icon.png'
import SegmentedControl from './components/ui/SegmentedControl.vue'
import Button from './components/ui/Button.vue'
import Modal from './components/ui/Modal.vue'

const store = useAppStore()
const route = useRoute()
type ThemeMode = 'system' | 'light' | 'dark'

const colorSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)')
const storedTheme = localStorage.getItem('vvtools-theme')
const themeMode = ref<ThemeMode>(
  storedTheme === 'light' || storedTheme === 'dark' || storedTheme === 'system'
    ? storedTheme
    : 'system'
)
const systemIsDark = ref(colorSchemeQuery.matches)
const isDark = computed(() =>
  themeMode.value === 'system' ? systemIsDark.value : themeMode.value === 'dark'
)
const sidebarCollapsed = ref(localStorage.getItem('vvtools-sidebar-collapsed') === 'true')
const isMac = window.api.platform === 'darwin'
const isWindows = window.api.platform === 'win32'
const hasIntegratedTitlebar = isMac || isWindows
const releaseNotesOpen = ref(false)
const themes = [
  { value: 'system' as const, label: '跟随系统', icon: Monitor },
  { value: 'light' as const, label: '浅色模式', icon: Sun },
  { value: 'dark' as const, label: '深色模式', icon: Moon }
]
const currentTheme = computed(
  () => themes.find((theme) => theme.value === themeMode.value) ?? themes[0]
)
const navigation = [
  { to: '/image', label: '图片处理', icon: Images },
  { to: '/video', label: '视频处理', icon: Video },
  { to: '/audio', label: '音频处理', icon: Music },
  { to: '/pdf', label: 'PDF 处理', icon: FileText },
  { to: '/font', label: '字体处理', icon: Type },
  { to: '/settings', label: '设置', icon: Settings }
]
const currentPageLabel = computed(
  () => navigation.find((item) => item.to === route.path)?.label ?? 'VVTools'
)
const taskStatusLabel = computed(() =>
  store.activeCount > 0 ? `${store.activeCount} 个任务处理中` : '暂无处理任务'
)

watch(
  [themeMode, isDark],
  ([mode, dark]) => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    localStorage.setItem('vvtools-theme', mode)
    if (isWindows) void window.api.setWindowTheme(dark ? 'dark' : 'light')
  },
  { immediate: true }
)

watch(sidebarCollapsed, (collapsed) => {
  localStorage.setItem('vvtools-sidebar-collapsed', String(collapsed))
})

function handleSystemThemeChange(event: MediaQueryListEvent): void {
  systemIsDark.value = event.matches
}

onMounted(() => {
  colorSchemeQuery.addEventListener('change', handleSystemThemeChange)
  void store.initialize()
})

onBeforeUnmount(() => {
  colorSchemeQuery.removeEventListener('change', handleSystemThemeChange)
  store.dispose()
})
</script>

<template>
  <div
    class="app-shell"
    :class="{
      'app-window-overlay': hasIntegratedTitlebar
    }"
  >
    <header
      v-if="hasIntegratedTitlebar"
      class="app-titlebar"
      :class="{ 'app-titlebar-mac': isMac, 'app-titlebar-windows': isWindows }"
    >
      <div class="app-titlebar-actions">
        <button
          class="app-titlebar-button"
          type="button"
          :aria-label="sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'"
          :title="sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'"
          @click="sidebarCollapsed = !sidebarCollapsed"
        >
          <span
            class="t-icon-swap size-4"
            :data-state="sidebarCollapsed ? 'b' : 'a'"
            aria-hidden="true"
          >
            <PanelLeftClose class="t-icon size-4" data-icon="a" />
            <PanelLeftOpen class="t-icon size-4" data-icon="b" />
          </span>
        </button>
      </div>
      <div class="app-titlebar-context" aria-live="polite">
        <span class="app-titlebar-page">{{ currentPageLabel }}</span>
        <span class="app-titlebar-separator" aria-hidden="true"></span>
        <span
          class="app-titlebar-task-status"
          :class="{ 'app-titlebar-task-status-active': store.activeCount > 0 }"
        >
          <span class="app-titlebar-task-dot" aria-hidden="true"></span>
          {{ taskStatusLabel }}
        </span>
      </div>
    </header>
    <aside class="app-sidebar" :class="{ 'app-sidebar-collapsed': sidebarCollapsed }">
      <div class="sidebar-brand">
        <div class="brand-mark">
          <img :src="appIcon" alt="" class="size-8 rounded-[9px]" />
        </div>
        <div class="sidebar-label brand-copy">
          <p class="brand-name">VVTools</p>
          <p class="brand-caption">媒体工作台</p>
        </div>
      </div>

      <nav class="sidebar-nav" aria-label="主导航">
        <RouterLink
          v-for="item in navigation"
          :key="item.to"
          :to="item.to"
          class="sidebar-link"
          active-class="sidebar-link-active"
          :title="sidebarCollapsed ? item.label : undefined"
        >
          <span class="sidebar-link-icon">
            <component :is="item.icon" class="size-4" />
          </span>
          <span class="sidebar-label">{{ item.label }}</span>
        </RouterLink>
      </nav>

      <div class="sidebar-footer">
        <Transition name="sidebar-footer-swap" mode="out-in">
          <SegmentedControl
            v-if="!sidebarCollapsed"
            class="sidebar-theme-segments"
            label="主题模式"
            hide-label
            icon-only
            :model-value="themeMode"
            :options="themes"
            @update:model-value="themeMode = $event as ThemeMode"
          />
          <div
            v-else
            class="sidebar-theme-current"
            role="img"
            :aria-label="currentTheme.label"
            :title="currentTheme.label"
          >
            <component :is="currentTheme.icon" class="size-4" aria-hidden="true" />
          </div>
        </Transition>
        <button
          v-if="store.appVersion"
          class="sidebar-label sidebar-version"
          type="button"
          :class="{
            'has-update': ['available', 'downloading', 'downloaded'].includes(
              store.updateState.status
            )
          }"
          :title="
            ['available', 'downloading', 'downloaded'].includes(store.updateState.status)
              ? '发现新版本 · 查看更新日志'
              : '查看更新日志'
          "
          @click="releaseNotesOpen = true"
        >
          VVTools · v{{ store.appVersion }}
          <span
            v-if="['available', 'downloading', 'downloaded'].includes(store.updateState.status)"
            class="sidebar-version-dot"
            aria-hidden="true"
          />
        </button>
      </div>
    </aside>

    <main class="app-main">
      <Transition name="alert-slide">
        <div v-if="store.errorMessage" role="alert" class="app-alert">
          <span>{{ store.errorMessage }}</span>
          <button
            class="app-alert-close"
            aria-label="关闭错误提示"
            @click="store.errorMessage = ''"
          >
            <X class="size-4" />
          </button>
        </div>
      </Transition>
      <RouterView v-slot="{ Component, route }">
        <Transition name="page-swap">
          <div :key="route.path" class="route-view">
            <component :is="Component" />
          </div>
        </Transition>
      </RouterView>
    </main>

    <Modal
      :open="releaseNotesOpen"
      title="更新日志"
      :description="`VVTools v${store.appVersion}`"
      @update:open="releaseNotesOpen = $event"
    >
      <div
        class="mt-5 whitespace-pre-wrap rounded-xl border border-border bg-muted/35 p-4 text-sm leading-6 text-foreground"
        :class="{ 'text-muted-foreground': !store.currentReleaseNotes }"
      >
        {{ store.currentReleaseNotes || '暂无更新日志' }}
      </div>
    </Modal>

    <Modal
      :open="store.updateDialog !== null"
      :title="store.updateDialog === 'downloaded' ? '更新已准备好' : '发现新版本'"
      :description="
        store.updateDialog === 'downloaded'
          ? '程序将关闭并安装新版本，是否立即重启？'
          : isMac
            ? `发现新版本 ${store.updateState.version ?? ''}，请前往 GitHub 下载。`
            : `新版本 ${store.updateState.version ?? ''} 已发布，是否现在下载？`
      "
      @update:open="!$event && (store.updateDialog = null)"
    >
      <div
        v-if="store.updateDialog === 'available' && store.updateState.releaseNotes"
        class="mt-5 whitespace-pre-wrap rounded-xl border border-border bg-muted/35 p-4 text-sm leading-6 text-foreground"
      >
        {{ store.updateState.releaseNotes }}
      </div>
      <p
        v-if="store.updateDialog === 'downloaded' && store.activeCount > 0"
        class="mt-5 rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-sm text-foreground"
      >
        当前还有 {{ store.activeCount }} 个任务正在处理，立即重启会取消这些任务。
      </p>
      <div class="mt-6 flex justify-end gap-2">
        <Button variant="secondary" @click="store.updateDialog = null">稍后</Button>
        <Button @click="store.confirmUpdateAction">
          <Download v-if="store.updateDialog === 'available'" class="size-4" />
          {{
            store.updateDialog === 'downloaded' ? '重启安装' : isMac ? '前往 GitHub' : '下载更新'
          }}
        </Button>
      </div>
    </Modal>
  </div>
</template>
