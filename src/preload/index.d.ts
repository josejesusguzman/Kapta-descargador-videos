import type { DescargadorApi } from '@shared/types'

declare global {
  interface Window {
    api: DescargadorApi
  }
}

export {}
