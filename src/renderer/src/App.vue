<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  History,
  Images,
  Maximize2,
  Minimize2,
  Minus,
  Monitor,
  Moon,
  Music,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sun,
  Video,
  X
} from '@lucide/vue'
import { useAppStore } from './stores/app'
import appIcon from '../../../resources/icon.png'

const store = useAppStore()
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
const isMaximized = ref(false)
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
  { to: '/history', label: '任务历史', icon: History },
  { to: '/settings', label: '设置', icon: Settings }
]

watch(
  [themeMode, isDark],
  ([mode, dark]) => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    localStorage.setItem('vvtools-theme', mode)
  },
  { immediate: true }
)

watch(sidebarCollapsed, (collapsed) => {
  localStorage.setItem('vvtools-sidebar-collapsed', String(collapsed))
})

function handleSystemThemeChange(event: MediaQueryListEvent): void {
  systemIsDark.value = event.matches
}

function minimizeWindow(): void {
  void window.api.windowMinimize()
}

async function toggleWindowMaximize(): Promise<void> {
  isMaximized.value = await window.api.windowToggleMaximize()
}

function closeWindow(): void {
  void window.api.windowClose()
}

onMounted(async () => {
  colorSchemeQuery.addEventListener('change', handleSystemThemeChange)
  const [, maximized] = await Promise.all([store.initialize(), window.api.windowIsMaximized()])
  isMaximized.value = maximized
})

onBeforeUnmount(() => {
  colorSchemeQuery.removeEventListener('change', handleSystemThemeChange)
})
</script>

<template>
  <div class="app-shell" :class="isMac ? 'app-platform-mac' : 'app-platform-desktop'">
    <header class="window-titlebar" aria-label="窗口标题栏">
      <div v-if="isMac" class="mac-window-controls">
        <button
          class="mac-window-button mac-window-close"
          type="button"
          aria-label="关闭窗口"
          title="关闭"
          @click="closeWindow"
        />
        <button
          class="mac-window-button mac-window-minimize"
          type="button"
          aria-label="最小化窗口"
          title="最小化"
          @click="minimizeWindow"
        />
        <button
          class="mac-window-button mac-window-maximize"
          type="button"
          aria-label="最大化窗口"
          title="最大化"
          @click="toggleWindowMaximize"
        />
      </div>
      <div v-else class="desktop-window-controls">
        <button
          class="desktop-window-button"
          type="button"
          aria-label="最小化窗口"
          title="最小化"
          @click="minimizeWindow"
        >
          <Minus class="size-4" />
        </button>
        <button
          class="desktop-window-button"
          type="button"
          :aria-label="isMaximized ? '还原窗口' : '最大化窗口'"
          :title="isMaximized ? '还原' : '最大化'"
          @click="toggleWindowMaximize"
        >
          <component :is="isMaximized ? Minimize2 : Maximize2" class="size-3.5" />
        </button>
        <button
          class="desktop-window-button desktop-window-close"
          type="button"
          aria-label="关闭窗口"
          title="关闭"
          @click="closeWindow"
        >
          <X class="size-4" />
        </button>
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
        <button
          class="sidebar-control sidebar-collapse"
          type="button"
          :aria-label="sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'"
          :title="sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'"
          @click="sidebarCollapsed = !sidebarCollapsed"
        >
          <component :is="sidebarCollapsed ? PanelLeftOpen : PanelLeftClose" class="size-4" />
        </button>
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
        <div v-if="!sidebarCollapsed" class="sidebar-theme-picker" aria-label="主题模式">
          <button
            v-for="theme in themes"
            :key="theme.value"
            class="sidebar-theme-button"
            :class="{ 'sidebar-theme-button-active': themeMode === theme.value }"
            type="button"
            :aria-label="theme.label"
            :aria-pressed="themeMode === theme.value"
            :title="theme.label"
            @click="themeMode = theme.value"
          >
            <component :is="theme.icon" class="size-4" aria-hidden="true" />
          </button>
        </div>
        <div
          v-else
          class="sidebar-theme-current"
          role="img"
          :aria-label="currentTheme.label"
          :title="currentTheme.label"
        >
          <component :is="currentTheme.icon" class="size-4" aria-hidden="true" />
        </div>
        <span class="sidebar-label sidebar-version">VVTools · v1.0.0</span>
      </div>
    </aside>

    <main class="app-main">
      <div v-if="isMac" class="main-window-drag-region" aria-hidden="true" />
      <div v-if="store.errorMessage" role="alert" class="app-alert">
        <span>{{ store.errorMessage }}</span>
        <button class="app-alert-close" aria-label="关闭错误提示" @click="store.errorMessage = ''">
          <X class="size-4" />
        </button>
      </div>
      <RouterView v-slot="{ Component, route }">
        <Transition name="page-swap">
          <div :key="route.path" class="route-view">
            <component :is="Component" />
          </div>
        </Transition>
      </RouterView>
    </main>
  </div>
</template>
