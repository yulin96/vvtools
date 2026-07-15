import { createRouter, createWebHashHistory } from 'vue-router'
import MediaWorkspace from './views/MediaWorkspace.vue'
import QueueView from './views/QueueView.vue'
import SettingsView from './views/SettingsView.vue'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/video' },
    { path: '/video', component: MediaWorkspace, props: { kind: 'video' } },
    { path: '/image', component: MediaWorkspace, props: { kind: 'image' } },
    { path: '/queue', component: QueueView },
    { path: '/settings', component: SettingsView }
  ]
})
