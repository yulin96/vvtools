<script setup lang="ts">
import { onMounted } from 'vue'
import { History, Images, Settings, Video, X } from '@lucide/vue'
import { useAppStore } from './stores/app'
import appIcon from '../../../resources/icon.png'

const store = useAppStore()
const navigation = [
  { to: '/image', label: '图片处理', icon: Images },
  { to: '/video', label: '视频处理', icon: Video },
  { to: '/history', label: '任务历史', icon: History },
  { to: '/settings', label: '设置', icon: Settings }
]

onMounted(() => store.initialize())
</script>

<template>
  <div class="flex h-screen min-h-0 bg-workspace text-foreground">
    <aside class="flex w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-3 py-4">
      <div class="mb-7 flex items-center gap-3 px-2">
        <img :src="appIcon" alt="VVTools" class="size-9 rounded-[10px]" />
        <div>
          <p class="text-sm font-semibold tracking-tight text-sidebar-foreground">VVTools</p>
          <p class="text-[11px] text-sidebar-muted">媒体批处理工具</p>
        </div>
      </div>
      <nav class="space-y-1" aria-label="主导航">
        <RouterLink
          v-for="item in navigation"
          :key="item.to"
          :to="item.to"
          class="group flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium text-sidebar-muted transition-colors hover:bg-sidebar-hover hover:text-sidebar-foreground"
          active-class="!bg-sidebar-active !text-sidebar-foreground"
        >
          <component :is="item.icon" class="size-4" />
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>
      <div
        class="mt-auto border-t border-sidebar-border px-2 pt-4 text-[11px] leading-5 text-sidebar-muted"
      >
        <p>v1.0.0</p>
      </div>
    </aside>

    <main class="relative min-w-0 flex-1 overflow-auto">
      <div
        v-if="store.errorMessage"
        role="alert"
        class="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-red-200 bg-red-50 px-6 py-2.5 text-sm text-red-900"
      >
        <span>{{ store.errorMessage }}</span>
        <button
          class="rounded p-1 hover:bg-red-100"
          aria-label="关闭错误提示"
          @click="store.errorMessage = ''"
        >
          <X class="size-4" />
        </button>
      </div>
      <RouterView :key="$route.path" />
    </main>
  </div>
</template>
