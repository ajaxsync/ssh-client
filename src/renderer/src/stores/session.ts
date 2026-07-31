import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useAppStore } from './app'
import { useToastStore } from './toast'
import type { TabColor } from '../../../shared/types'

export type MainPanel = 'terminal' | 'sftp' | 'metrics' | 'database'

export interface TabSession {
  sessionId: string
  hostId: string
  title: string
  color: TabColor
  note?: string
  closed: boolean
  intentionalClose: boolean
  reconnecting: boolean
  reconnectAttempts: number
  error?: string
}

function connectionTitle(baseTitle: string, hostId: string, tabs: TabSession[]): string {
  const sameHost = tabs.filter((t) => t.hostId === hostId)
  if (sameHost.length === 0) return baseTitle
  return `${baseTitle} #${sameHost.length + 1}`
}

export const useSessionStore = defineStore('session', () => {
  const tabs = ref<TabSession[]>([])
  const activeSessionId = ref<string | null>(null)
  const panel = ref<MainPanel>('terminal')
  const connecting = ref(false)
  const connectingHostId = ref<string | null>(null)

  const activeTab = computed(() => tabs.value.find((t) => t.sessionId === activeSessionId.value))

  async function connect(hostId: string, cols = 80, rows = 24): Promise<string | null> {
    const app = useAppStore()
    connecting.value = true
    connectingHostId.value = hostId
    try {
      const res = await window.api.session.connect({ hostId, cols, rows })
      if (!res.ok) throw new Error(res.error)
      const host = app.hosts.find((h) => h.id === hostId)
      const baseTitle = res.data.title
      tabs.value.push({
        sessionId: res.data.sessionId,
        hostId: res.data.hostId,
        title: connectionTitle(baseTitle, hostId, tabs.value),
        color: host?.color || 'default',
        note: host?.note,
        closed: false,
        intentionalClose: false,
        reconnecting: false,
        reconnectAttempts: 0
      })
      activeSessionId.value = res.data.sessionId
      panel.value = 'terminal'
      return res.data.sessionId
    } finally {
      connecting.value = false
      connectingHostId.value = null
    }
  }

  async function connectSameHost(): Promise<void> {
    const tab = activeTab.value
    if (!tab || tab.closed || connecting.value) return
    await connect(tab.hostId)
  }

  async function closeTab(sessionId: string): Promise<void> {
    const tab = tabs.value.find((t) => t.sessionId === sessionId)
    if (tab) tab.intentionalClose = true
    await window.api.session.disconnect(sessionId)
    tabs.value = tabs.value.filter((t) => t.sessionId !== sessionId)
    if (activeSessionId.value === sessionId) {
      activeSessionId.value = tabs.value[0]?.sessionId ?? null
    }
  }

  async function handleClosed(sessionId: string): Promise<void> {
    const tab = tabs.value.find((t) => t.sessionId === sessionId)
    if (!tab) return

    if (tab.intentionalClose) {
      tab.closed = true
      return
    }

    const app = useAppStore()
    if (!app.settings.autoReconnect) {
      tab.closed = true
      return
    }

    tab.reconnecting = true
    tab.error = undefined
    const max = app.settings.autoReconnectMaxAttempts
    const delay = app.settings.autoReconnectDelayMs
    let lastError = ''

    while (tab.reconnectAttempts < max) {
      // 用户可能在重连过程中主动关闭标签
      if (tab.intentionalClose || !tabs.value.some((t) => t.sessionId === sessionId || t === tab)) {
        tab.reconnecting = false
        return
      }

      tab.reconnectAttempts += 1
      await new Promise((r) => setTimeout(r, delay))

      if (tab.intentionalClose) {
        tab.reconnecting = false
        return
      }

      try {
        const res = await window.api.session.connect({ hostId: tab.hostId })
        if (!res.ok) throw new Error(res.error)
        const oldId = tab.sessionId
        tab.sessionId = res.data.sessionId
        tab.closed = false
        tab.error = undefined
        tab.reconnecting = false
        if (activeSessionId.value === oldId) activeSessionId.value = tab.sessionId
        return
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
      }
    }

    tab.reconnecting = false
    tab.closed = true
    tab.error = lastError || '自动重连次数已用尽'
  }

  function markError(sessionId: string, message: string): void {
    const tab = tabs.value.find((t) => t.sessionId === sessionId)
    if (tab) tab.error = message
    if (message) useToastStore().error(message)
  }

  function setActive(sessionId: string): void {
    activeSessionId.value = sessionId
  }

  function setPanel(next: MainPanel): void {
    panel.value = next
  }

  function clearAll(): void {
    tabs.value = []
    activeSessionId.value = null
  }

  return {
    tabs,
    activeSessionId,
    activeTab,
    panel,
    connecting,
    connectingHostId,
    connect,
    connectSameHost,
    closeTab,
    handleClosed,
    markError,
    setActive,
    setPanel,
    clearAll
  }
})
