import { createRouter, createWebHashHistory } from 'vue-router'
import ImageWorkspace from './views/ImageWorkspace.vue'
import SettingsView from './views/SettingsView.vue'
import VideoWorkspace from './views/VideoWorkspace.vue'
import TaskHistoryView from './views/TaskHistoryView.vue'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/image' },
    { path: '/video', component: VideoWorkspace },
    { path: '/image', component: ImageWorkspace },
    { path: '/history', component: TaskHistoryView },
    { path: '/queue', redirect: '/history' },
    { path: '/settings', component: SettingsView }
  ]
})
