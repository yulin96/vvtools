import { createRouter, createWebHashHistory } from 'vue-router'
import ImageWorkspace from './views/ImageWorkspace.vue'
import SettingsView from './views/SettingsView.vue'
import VideoWorkspace from './views/VideoWorkspace.vue'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/video' },
    { path: '/video', component: VideoWorkspace },
    { path: '/image', component: ImageWorkspace },
    { path: '/queue', redirect: '/video' },
    { path: '/settings', component: SettingsView }
  ]
})
