<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import { useAppStore } from '../stores/app'
import { CommandLineBuffer } from '../lib/command-history'

const props = defineProps<{
  sessionId: string
  hostId: string
  active: boolean
}>()

const app = useAppStore()
const root = ref<HTMLDivElement | null>(null)
const showSearch = ref(false)
const query = ref('')
const searchInfo = ref('')

let term: Terminal | null = null
let fit: FitAddon | null = null
let search: SearchAddon | null = null
let offData: (() => void) | undefined
let ro: ResizeObserver | null = null
let onContextMenu: ((e: MouseEvent) => void) | null = null
let onWheel: ((e: WheelEvent) => void) | null = null
const lineBuf = new CommandLineBuffer()

const FONT_MIN = 10
const FONT_MAX = 28

function themeFromSettings() {
  const dark = app.settings.theme === 'dark'
  return {
    background: dark ? '#0a1018' : '#f7fafc',
    foreground: dark ? '#e8eef8' : '#1a2433',
    cursor: dark ? '#8cc6ff' : '#2f7fe8',
    cursorAccent: dark ? '#0a1018' : '#ffffff',
    selectionBackground: dark ? '#6cb6ff55' : '#2f7fe833'
  }
}

function copySelection(): boolean {
  if (!term) return false
  const text = term.getSelection()
  if (!text) return false
  window.api.clipboard.writeText(text)
  return true
}

function pasteClipboard(): void {
  if (!term || !props.active) return
  const text = window.api.clipboard.readText()
  if (!text) return
  term.paste(text)
}

function onKeydown(e: KeyboardEvent): void {
  if (!props.active) return
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
    e.preventDefault()
    showSearch.value = true
  }
  if (e.key === 'Escape' && showSearch.value) {
    showSearch.value = false
    search?.clearDecorations()
  }
}

function findNext(): void {
  if (!search || !query.value) return
  const ok = search.findNext(query.value, { caseSensitive: false, incremental: false })
  searchInfo.value = ok ? '' : '无匹配'
}

function findPrev(): void {
  if (!search || !query.value) return
  const ok = search.findPrevious(query.value, { caseSensitive: false })
  searchInfo.value = ok ? '' : '无匹配'
}

function changeFontSize(delta: number): void {
  const next = Math.min(FONT_MAX, Math.max(FONT_MIN, app.settings.fontSize + delta))
  if (next === app.settings.fontSize) return
  void app.saveSettings({ ...app.settings, fontSize: next })
}

function onWheelZoom(e: WheelEvent): void {
  if (!props.active || !term) return
  if (!e.ctrlKey && !e.metaKey) return
  e.preventDefault()
  const delta = e.deltaY < 0 ? 1 : e.deltaY > 0 ? -1 : 0
  if (delta) changeFontSize(delta)
}

onMounted(() => {
  if (!root.value) return

  term = new Terminal({
    cursorBlink: true,
    fontFamily: "Cascadia Code, Consolas, 'Courier New', monospace",
    fontSize: app.settings.fontSize,
    theme: themeFromSettings(),
    allowProposedApi: true,
    scrollback: 5000
  })
  fit = new FitAddon()
  search = new SearchAddon()
  term.loadAddon(fit)
  term.loadAddon(search)
  term.open(root.value)
  fit.fit()
  window.api.session.resize(props.sessionId, term.cols, term.rows)

  term.attachCustomKeyEventHandler((ev) => {
    if (ev.type !== 'keydown') return true
    const key = ev.key.toLowerCase()
    const mod = ev.ctrlKey || ev.metaKey
    if (!mod) return true

    // Ctrl/Cmd+Shift+C 或有选区时 Ctrl/Cmd+C → 复制
    if (key === 'c' && (ev.shiftKey || term?.hasSelection())) {
      if (copySelection()) {
        ev.preventDefault()
        return false
      }
      // 无选区且未按 Shift：放行给远端（SIGINT）
      if (!ev.shiftKey) return true
      ev.preventDefault()
      return false
    }

    // Ctrl/Cmd+V、Ctrl/Cmd+Shift+V → 粘贴
    if (key === 'v') {
      ev.preventDefault()
      pasteClipboard()
      return false
    }

    return true
  })

  onContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    if (!props.active) return
    // 有选区：复制；否则粘贴（常见终端习惯）
    if (term?.hasSelection()) copySelection()
    else pasteClipboard()
  }
  term.element?.addEventListener('contextmenu', onContextMenu)

  onWheel = onWheelZoom
  root.value.addEventListener('wheel', onWheel, { passive: false })

  term.onData((data) => {
    for (const cmd of lineBuf.feed(data)) {
      void app.pushCommandHistory(props.hostId, cmd)
    }
    window.api.session.write(props.sessionId, data)
  })

  offData = window.api.session.onData(({ sessionId, data }) => {
    if (sessionId !== props.sessionId || !term) return
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
    term.write(bytes)
  })

  ro = new ResizeObserver(() => {
    if (!props.active || !fit || !term) return
    fit.fit()
    window.api.session.resize(props.sessionId, term.cols, term.rows)
  })
  ro.observe(root.value)
  window.addEventListener('keydown', onKeydown)
})

watch(
  () => props.active,
  (active) => {
    if (active && fit && term) {
      requestAnimationFrame(() => {
        fit?.fit()
        if (term) window.api.session.resize(props.sessionId, term.cols, term.rows)
        term?.focus()
      })
    }
  }
)

watch(
  () => props.sessionId,
  () => {
    // 重连后 sessionId 变化，终端组件需由父级用 :key 重建；此处保底清屏
    lineBuf.clear()
    term?.reset()
  }
)

watch(
  () => [app.settings.fontSize, app.settings.theme] as const,
  () => {
    if (!term) return
    term.options.fontSize = app.settings.fontSize
    term.options.theme = themeFromSettings()
    fit?.fit()
    if (props.active) {
      window.api.session.resize(props.sessionId, term.cols, term.rows)
    }
  }
)

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  if (onWheel && root.value) {
    root.value.removeEventListener('wheel', onWheel)
  }
  onWheel = null
  if (onContextMenu && term?.element) {
    term.element.removeEventListener('contextmenu', onContextMenu)
  }
  onContextMenu = null
  offData?.()
  ro?.disconnect()
  term?.dispose()
  term = null
  fit = null
  search = null
})
</script>

<template>
  <div class="wrap">
    <div v-if="showSearch" class="search-bar">
      <input
        v-model="query"
        class="glass-field"
        placeholder="搜索终端输出 (Enter)"
        autofocus
        @keydown.enter.prevent="findNext"
      />
      <button class="btn-glass sm" @click="findPrev">上一个</button>
      <button class="btn-glass sm" @click="findNext">下一个</button>
      <span class="info">{{ searchInfo }}</span>
      <button class="btn-icon" title="关闭" @click="showSearch = false">×</button>
    </div>
    <div ref="root" class="term" />
  </div>
</template>

<style scoped>
.wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.search-bar {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 8px 10px;
  border-bottom: 1px solid var(--glass-border);
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(10px);
}

.search-bar input {
  flex: 1;
  min-width: 0;
}

.info {
  font-size: 12px;
  color: var(--text-muted);
  min-width: 48px;
}

.term {
  flex: 1;
  min-height: 0;
  padding: 10px 12px;
  background: #0a1018;
}

:global([data-theme='light']) .term {
  background: #f7fafc;
}
</style>
