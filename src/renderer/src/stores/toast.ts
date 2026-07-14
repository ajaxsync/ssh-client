import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ToastType = 'error' | 'info' | 'success'

export interface ToastItem {
  id: string
  type: ToastType
  text: string
}

const MAX_TOASTS = 3

export const useToastStore = defineStore('toast', () => {
  const items = ref<ToastItem[]>([])
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  function dismiss(id: string): void {
    const t = timers.get(id)
    if (t) {
      clearTimeout(t)
      timers.delete(id)
    }
    items.value = items.value.filter((x) => x.id !== id)
  }

  function clear(): void {
    for (const id of timers.keys()) {
      const t = timers.get(id)
      if (t) clearTimeout(t)
    }
    timers.clear()
    items.value = []
  }

  function show(type: ToastType, text: string, duration = 4000): string {
    const msg = (text || '').trim()
    if (!msg) return ''
    const id = crypto.randomUUID()
    items.value = [...items.value, { id, type, text: msg }].slice(-MAX_TOASTS)
    if (duration > 0) {
      timers.set(
        id,
        setTimeout(() => {
          dismiss(id)
        }, duration)
      )
    }
    return id
  }

  function error(text: string, duration = 4000): string {
    return show('error', text, duration)
  }

  function info(text: string, duration = 3500): string {
    return show('info', text, duration)
  }

  function success(text: string, duration = 3000): string {
    return show('success', text, duration)
  }

  return { items, show, error, info, success, dismiss, clear }
})
