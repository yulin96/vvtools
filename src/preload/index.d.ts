import type { VVToolsApi } from '../shared/types'

declare global {
  interface Window {
    api: VVToolsApi
  }
}
