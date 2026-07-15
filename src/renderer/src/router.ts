import { createRouter, createWebHashHistory } from 'vue-router'
import MediaWorkspace from './views/MediaWorkspace.vue'
import SettingsView from './views/SettingsView.vue'
import VideoWorkspace from './views/VideoWorkspace.vue'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/video' },
    { path: '/video', component: VideoWorkspace },
    { path: '/image', component: MediaWorkspace, props: { kind: 'image' } },
    { path: '/queue', redirect: '/video' },
    { path: '/settings', component: SettingsView }
  ]
})
