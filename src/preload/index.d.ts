import type { KaptaDescargadorApi } from '@shared/types'

declare global {
  interface Window {
    api: KaptaDescargadorApi
  }
}

export {}
