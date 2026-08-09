import { createRouter, createWebHashHistory } from 'vue-router'
import ImageWorkspace from './views/ImageWorkspace.vue'
import SettingsView from './views/SettingsView.vue'
import VideoWorkspace from './views/VideoWorkspace.vue'
import AudioWorkspace from './views/AudioWorkspace.vue'
import FontWorkspace from './views/FontWorkspace.vue'
import PdfWorkspace from './views/PdfWorkspace.vue'
import RenameWorkspace from './views/RenameWorkspace.vue'

const mediaPaths = ['/image', '/video', '/audio', '/pdf', '/font'] as const
type MediaPath = (typeof mediaPaths)[number]
const lastMediaPathKey = 'vvtools-last-media-path'

function isMediaPath(path: string | null): path is MediaPath {
  return mediaPaths.some((mediaPath) => mediaPath === path)
}

function initialMediaPath(): MediaPath {
  const storedPath = localStorage.getItem(lastMediaPathKey)
  return isMediaPath(storedPath) ? storedPath : '/image'
}

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: initialMediaPath() },
    { path: '/video', component: VideoWorkspace },
    { path: '/audio', component: AudioWorkspace },
    { path: '/pdf', component: PdfWorkspace },
    { path: '/font', component: FontWorkspace },
    { path: '/rename', component: RenameWorkspace },
    { path: '/image', component: ImageWorkspace },
    { path: '/settings', component: SettingsView },
    { path: '/:pathMatch(.*)*', redirect: '/image' }
  ]
})

router.afterEach((to) => {
  if (isMediaPath(to.path)) localStorage.setItem(lastMediaPathKey, to.path)
})
