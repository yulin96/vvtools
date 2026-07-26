import { createRouter, createWebHashHistory } from 'vue-router'
import ImageWorkspace from './views/ImageWorkspace.vue'
import SettingsView from './views/SettingsView.vue'
import VideoWorkspace from './views/VideoWorkspace.vue'
import AudioWorkspace from './views/AudioWorkspace.vue'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/image' },
    { path: '/video', component: VideoWorkspace },
    { path: '/audio', component: AudioWorkspace },
    { path: '/image', component: ImageWorkspace },
    { path: '/settings', component: SettingsView },
    { path: '/:pathMatch(.*)*', redirect: '/image' }
  ]
})
