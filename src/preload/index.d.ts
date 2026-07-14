import { SshApi } from './index'

declare global {
  interface Window {
    api: SshApi
  }
}

export {}
