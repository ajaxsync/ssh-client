import { defineStore } from 'pinia'
import { ref } from 'vue'
import type {
  AppSettings,
  HostConfig,
  SftpBookmark,
  Snippet,
  TrashHostItem,
  VaultStatus
} from '../../../shared/types'
import { DEFAULT_SETTINGS, METRICS_LAYOUT_VERSION, resolveMetricsLayout } from '../../../shared/types'

export const useAppStore = defineStore('app', () => {
  const vault = ref<VaultStatus>({
    initialized: false,
    unlocked: false,
    protection: null,
    osUnlockAvailable: false,
    canAutoUnlock: false
  })
  const hosts = ref<HostConfig[]>([])
  const settings = ref<AppSettings>({ ...DEFAULT_SETTINGS })
  const snippets = ref<Snippet[]>([])
  const bookmarks = ref<SftpBookmark[]>([])
  const trash = ref<TrashHostItem[]>([])
  const error = ref('')
  const busy = ref(false)

  async function refreshStatus(): Promise<void> {
    const res = await window.api.vault.status()
    if (res.ok) vault.value = res.data
  }

  async function setup(password: string): Promise<boolean> {
    busy.value = true
    error.value = ''
    try {
      const res = await window.api.vault.setup(password)
      if (!res.ok) {
        error.value = res.error
        return false
      }
      await refreshStatus()
      await loadWorkspace()
      return true
    } finally {
      busy.value = false
    }
  }

  async function setupOs(): Promise<boolean> {
    busy.value = true
    error.value = ''
    try {
      const res = await window.api.vault.setupOs()
      if (!res.ok) {
        error.value = res.error
        return false
      }
      await refreshStatus()
      await loadWorkspace()
      return true
    } finally {
      busy.value = false
    }
  }

  async function unlock(password: string): Promise<boolean> {
    busy.value = true
    error.value = ''
    try {
      const res = await window.api.vault.unlock(password)
      if (!res.ok) {
        error.value = res.error
        return false
      }
      await refreshStatus()
      await loadWorkspace()
      return true
    } finally {
      busy.value = false
    }
  }

  async function unlockOs(): Promise<boolean> {
    busy.value = true
    error.value = ''
    try {
      const res = await window.api.vault.unlockOs()
      if (!res.ok) {
        error.value = res.error
        return false
      }
      await refreshStatus()
      await loadWorkspace()
      return true
    } finally {
      busy.value = false
    }
  }

  async function tryAutoUnlock(): Promise<boolean> {
    error.value = ''
    const res = await window.api.vault.tryAutoUnlock()
    if (!res.ok) {
      error.value = res.error
      await refreshStatus()
      return false
    }
    vault.value = res.data
    if (!res.data.unlocked) return false
    await loadWorkspace()
    return true
  }

  async function resetVault(): Promise<boolean> {
    busy.value = true
    error.value = ''
    try {
      const res = await window.api.vault.reset()
      if (!res.ok) {
        error.value = res.error
        return false
      }
      hosts.value = []
      snippets.value = []
      bookmarks.value = []
      trash.value = []
      settings.value = { ...DEFAULT_SETTINGS }
      await refreshStatus()
      return true
    } finally {
      busy.value = false
    }
  }

  async function lock(): Promise<void> {
    await window.api.vault.lock()
    hosts.value = []
    snippets.value = []
    bookmarks.value = []
    trash.value = []
    settings.value = { ...DEFAULT_SETTINGS }
    await refreshStatus()
  }

  async function loadWorkspace(): Promise<void> {
    const [hostsRes, settingsRes, snipRes, bookmarkRes, trashRes] = await Promise.all([
      window.api.hosts.list(),
      window.api.settings.get(),
      window.api.snippets.list(),
      window.api.bookmarks.list(),
      window.api.trash.list()
    ])
    if (hostsRes.ok) hosts.value = hostsRes.data
    if (settingsRes.ok) {
      settings.value = {
        ...DEFAULT_SETTINGS,
        ...settingsRes.data,
        metricsLayout: resolveMetricsLayout(
          settingsRes.data.metricsLayout,
          settingsRes.data.metricsLayoutVersion
        ),
        metricsLayoutVersion: METRICS_LAYOUT_VERSION
      }
      document.documentElement.setAttribute('data-theme', settings.value.theme)
      if ((settingsRes.data.metricsLayoutVersion || 0) < METRICS_LAYOUT_VERSION) {
        void saveSettings(settings.value)
      }
    }
    if (snipRes.ok) snippets.value = snipRes.data
    if (bookmarkRes.ok) bookmarks.value = bookmarkRes.data
    if (trashRes.ok) trash.value = trashRes.data
  }

  async function saveHost(host: HostConfig): Promise<boolean> {
    const res = await window.api.hosts.save(host)
    if (!res.ok) {
      error.value = res.error
      return false
    }
    await loadWorkspace()
    return true
  }

  async function deleteHost(id: string): Promise<boolean> {
    const res = await window.api.hosts.delete(id)
    if (!res.ok) {
      error.value = res.error
      return false
    }
    await loadWorkspace()
    return true
  }

  async function restoreHost(id: string): Promise<boolean> {
    const res = await window.api.trash.restore(id)
    if (!res.ok) {
      error.value = res.error
      return false
    }
    await loadWorkspace()
    return true
  }

  async function purgeHost(id: string): Promise<void> {
    await window.api.trash.purge(id)
    await loadWorkspace()
  }

  async function emptyTrash(): Promise<void> {
    await window.api.trash.empty()
    await loadWorkspace()
  }

  async function saveSettings(next: AppSettings): Promise<void> {
    const res = await window.api.settings.set({
      ...next,
      metricsLayout: resolveMetricsLayout(next.metricsLayout, next.metricsLayoutVersion),
      metricsLayoutVersion: METRICS_LAYOUT_VERSION
    })
    if (res.ok) {
      settings.value = res.data
      document.documentElement.setAttribute('data-theme', res.data.theme)
    }
  }

  async function saveSnippet(snippet: Snippet): Promise<void> {
    const res = await window.api.snippets.save(snippet)
    if (res.ok) await loadWorkspace()
  }

  async function deleteSnippet(id: string): Promise<void> {
    await window.api.snippets.delete(id)
    await loadWorkspace()
  }

  async function saveBookmark(bookmark: SftpBookmark): Promise<void> {
    await window.api.bookmarks.save(bookmark)
    await loadWorkspace()
  }

  async function deleteBookmark(id: string): Promise<void> {
    await window.api.bookmarks.delete(id)
    await loadWorkspace()
  }

  async function importSshConfig(): Promise<string> {
    const res = await window.api.hosts.importSshConfig()
    if (!res.ok) return res.error
    await loadWorkspace()
    return `已导入 ${res.data.length} 台主机`
  }

  async function importCsv(): Promise<string> {
    const file = await window.api.dialog.openFile([{ name: 'CSV', extensions: ['csv', 'txt'] }])
    if (!file.ok || !file.data) return '已取消'
    const res = await window.api.hosts.importCsv(file.data)
    if (!res.ok) return res.error
    await loadWorkspace()
    return `已导入 ${res.data.length} 台主机`
  }

  return {
    vault,
    hosts,
    settings,
    snippets,
    bookmarks,
    trash,
    error,
    busy,
    refreshStatus,
    setup,
    setupOs,
    unlock,
    unlockOs,
    tryAutoUnlock,
    resetVault,
    lock,
    loadWorkspace,
    saveHost,
    deleteHost,
    restoreHost,
    purgeHost,
    emptyTrash,
    saveSettings,
    saveSnippet,
    deleteSnippet,
    saveBookmark,
    deleteBookmark,
    importSshConfig,
    importCsv
  }
})
