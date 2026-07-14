<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { SftpBookmark, SftpEntry, TransferProgress } from '../../../shared/types'
import { useAppStore } from '../stores/app'
import { useToastStore } from '../stores/toast'
import GlassTip from './ui/GlassTip.vue'
import GlassStatusToast from './ui/GlassStatusToast.vue'

const props = defineProps<{
  sessionId: string
  hostId: string
  disabled?: boolean
}>()

const app = useAppStore()
const toast = useToastStore()
const path = ref('.')
const entries = ref<SftpEntry[]>([])
const cwdWritable = ref(true)
const loading = ref(false)
const progress = ref<TransferProgress | null>(null)
const selected = ref<SftpEntry | null>(null)
const dragOver = ref(false)
const extracting = ref(false)
const pathHistory = ref<string[]>([])
const showHistory = ref(false)
const showPathSuggest = ref(false)
const pathFieldRef = ref<HTMLElement | null>(null)
const historyMenuRef = ref<HTMLElement | null>(null)

/** 服务器侧高频目录（登录家目录用 . 表示） */
const COMMON_PLACES: { label: string; path: string }[] = [
  { label: '根目录', path: '/' },
  { label: '主目录', path: '.' },
  { label: '用户家', path: '/home' },
  { label: '日志', path: '/var/log' },
  { label: '配置', path: '/etc' }
]

const editorOpen = ref(false)
const editorMode = ref<'preview' | 'edit'>('preview')
const editorPath = ref('')
const editorName = ref('')
const editorContent = ref('')
const editorOriginal = ref('')
const editorTruncated = ref(false)
const editorLoading = ref(false)
const editorSaving = ref(false)
const editorWritable = ref(false)

/** 应用内名称输入（Electron 不支持 window.prompt） */
const namePrompt = ref<{
  title: string
  value: string
  resolve: (v: string | null) => void
} | null>(null)
const namePromptInput = ref<HTMLInputElement | null>(null)

function askName(title: string, initial = ''): Promise<string | null> {
  return new Promise((resolve) => {
    namePrompt.value = { title, value: initial, resolve }
    requestAnimationFrame(() => {
      namePromptInput.value?.focus()
      namePromptInput.value?.select()
    })
  })
}

function submitNamePrompt(): void {
  if (!namePrompt.value) return
  const raw = namePrompt.value.value.trim()
  const { resolve } = namePrompt.value
  namePrompt.value = null
  resolve(raw || null)
}

function cancelNamePrompt(): void {
  if (!namePrompt.value) return
  const { resolve } = namePrompt.value
  namePrompt.value = null
  resolve(null)
}

let offProgress: (() => void) | undefined

function pushHistory(p: string): void {
  if (!p) return
  pathHistory.value = [p, ...pathHistory.value.filter((x) => x !== p)].slice(0, 24)
}

const pathDraft = ref('~')
const pathInputEl = ref<HTMLInputElement | null>(null)
const pathEditing = ref(false)

function formatPathForDisplay(p: string): string {
  if (!p || p === '.') return '~'
  return p
}

function syncPathDraft(): void {
  if (pathEditing.value) return
  pathDraft.value = formatPathForDisplay(path.value)
}

/** 解析「cd /a/b」或直接路径 */
function parseGotoInput(raw: string): string | null {
  let s = raw.trim()
  if (!s) return null

  const cdMatch = s.match(/^cd(?:\s+(.+))?$/i)
  if (cdMatch) {
    s = (cdMatch[1] || '').trim()
    if (!s) return '.'
  }

  if (
    (s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
    (s.startsWith("'") && s.endsWith("'") && s.length >= 2)
  ) {
    s = s.slice(1, -1)
  }

  if (s === '~' || s === '~/') return '.'
  if (s.startsWith('~/')) s = s.slice(2)

  if (s === '.' || s === '/') return s

  // 相对路径：基于当前目录拼接
  if (!s.startsWith('/')) {
    const base = path.value === '.' ? '' : path.value.replace(/\/+$/, '')
    if (!base || base === '.') return s
    if (base === '/') return `/${s}`
    return `${base}/${s}`
  }

  return s.replace(/\/+/g, '/').replace(/\/$/, '') || '/'
}

function friendlyPathError(msg: string): string {
  const m = (msg || '').toLowerCase()
  if (
    m.includes('no such') ||
    m.includes('not found') ||
    m.includes('enoent') ||
    m.includes('failure') ||
    m.includes('不存在')
  ) {
    return '路径无效或不存在，未跳转'
  }
  if (m.includes('permission') || m.includes('denied') || m.includes('权限')) {
    return '没有权限访问该路径，未跳转'
  }
  return msg || '路径无效，未跳转'
}

/** 先探测再跳转：失败则保持当前路径 */
async function navigateTo(target: string): Promise<boolean> {
  if (props.disabled) return false
  loading.value = true
  showHistory.value = false
  showPathSuggest.value = false
  try {
    const res = await window.api.sftp.list(props.sessionId, target)
    if (!res.ok) {
      toast.error(friendlyPathError(res.error))
      return false
    }
    path.value = target
    entries.value = res.data.entries
    cwdWritable.value = res.data.canWrite
    selected.value = null
    pushHistory(target)
    return true
  } catch (e) {
    toast.error(friendlyPathError(e instanceof Error ? e.message : String(e)))
    return false
  } finally {
    loading.value = false
  }
}

async function submitPathDraft(): Promise<void> {
  const next = parseGotoInput(pathDraft.value)
  if (!next) {
    toast.error('请输入有效路径或 cd 命令')
    return
  }
  const ok = await navigateTo(next)
  if (ok) {
    pathEditing.value = false
    showPathSuggest.value = false
    syncPathDraft()
    pathInputEl.value?.blur()
  }
}

function onPathFocus(): void {
  pathEditing.value = true
  showHistory.value = false
  showPathSuggest.value = true
  // 激活时可改路径或输入 cd 命令，选中方便覆盖输入
  pathDraft.value = formatPathForDisplay(path.value)
  requestAnimationFrame(() => pathInputEl.value?.select())
}

function onPathBlur(): void {
  pathEditing.value = false
  showPathSuggest.value = false
  // 取消激活：恢复展示当前路径（丢弃未提交的命令）
  pathDraft.value = formatPathForDisplay(path.value)
}

const bookmarks = computed(() =>
  app.bookmarks.filter((b) => !b.hostId || b.hostId === props.hostId)
)

const currentBookmark = computed(() => bookmarks.value.find((b) => b.path === path.value))

function historyLabel(h: string): string {
  return formatPathForDisplay(h)
}

function placeDisplayPath(p: string): string {
  return formatPathForDisplay(p)
}

async function pickSuggestPath(target: string): Promise<void> {
  showPathSuggest.value = false
  pathInputEl.value?.blur()
  await goPath(target)
}

async function pickBookmark(b: SftpBookmark): Promise<void> {
  showPathSuggest.value = false
  pathInputEl.value?.blur()
  await goPath(b.path)
}

const parentPath = computed(() => {
  if (path.value === '.' || path.value === '/') return null
  const normalized = path.value.replace(/\/+$/, '')
  const idx = normalized.lastIndexOf('/')
  if (idx <= 0) return path.value.startsWith('/') ? '/' : '.'
  return normalized.slice(0, idx) || '/'
})

const sortedEntries = computed(() =>
  [...entries.value].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
)

function isArchive(name: string): boolean {
  const lower = name.toLowerCase()
  return (
    lower.endsWith('.zip') ||
    lower.endsWith('.tar') ||
    lower.endsWith('.tar.gz') ||
    lower.endsWith('.tgz') ||
    lower.endsWith('.tar.bz2') ||
    lower.endsWith('.tbz2') ||
    lower.endsWith('.tar.xz')
  )
}

async function refresh(): Promise<void> {
  if (props.disabled) return
  loading.value = true
  try {
    const res = await window.api.sftp.list(props.sessionId, path.value)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    entries.value = res.data.entries
    cwdWritable.value = res.data.canWrite
    if (selected.value && !entries.value.some((e) => e.path === selected.value?.path)) {
      selected.value = null
    }
  } finally {
    loading.value = false
  }
}

async function goPath(next: string): Promise<void> {
  if (props.disabled) return
  const target = next || '.'
  if (target === path.value) {
    await refresh()
    pathEditing.value = false
    syncPathDraft()
    return
  }
  const ok = await navigateTo(target)
  pathEditing.value = false
  syncPathDraft()
  if (!ok) return
}

async function openEntry(entry: SftpEntry): Promise<void> {
  if (isEntryLocked(entry)) return
  selected.value = entry
  if (!entry.isDirectory) {
    if (entry.canRead) await openEditor(entry, 'preview')
    return
  }
  if (!entry.canRead) {
    toast.error('没有权限进入该目录')
    return
  }
  await goPath(entry.path)
}

function toggleHistory(): void {
  showPathSuggest.value = false
  showHistory.value = !showHistory.value
}

async function goParent(): Promise<void> {
  if (!parentPath.value) return
  await goPath(parentPath.value)
}

async function mkdir(): Promise<void> {
  if (!cwdWritable.value) return
  const name = await askName('新建文件夹名称')
  if (!name) return
  if (name.includes('/') || name.includes('\\')) {
    toast.error('文件夹名称不能包含路径分隔符')
    return
  }
  const base = path.value.replace(/\/$/, '')
  const remote = !base || base === '.' ? name : `${base}/${name}`
  const res = await window.api.sftp.mkdir(props.sessionId, remote)
  if (!res.ok) {
    toast.error(res.error)
    return
  }
  await refresh()
}

async function renameEntry(entry: SftpEntry): Promise<void> {
  if (!cwdWritable.value) return
  const name = await askName('重命名', entry.name)
  if (!name || name === entry.name) return
  if (name.includes('/') || name.includes('\\')) {
    toast.error('名称不能包含路径分隔符')
    return
  }
  const parent = entry.path.slice(0, entry.path.lastIndexOf('/')) || '/'
  const to = (parent === '/' ? '' : parent) + '/' + name
  const res = await window.api.sftp.rename(props.sessionId, entry.path, to)
  if (!res.ok) {
    toast.error(res.error)
    return
  }
  await refresh()
}

async function removeEntry(entry: SftpEntry): Promise<void> {
  if (!cwdWritable.value) return
  if (!confirm(`删除 ${entry.name}？`)) return
  const res = await window.api.sftp.remove(props.sessionId, entry.path, entry.isDirectory)
  if (!res.ok) {
    toast.error(res.error)
    return
  }
  if (selected.value?.path === entry.path) selected.value = null
  await refresh()
}

async function uploadPaths(localPaths: string[]): Promise<void> {
  if (!cwdWritable.value) {
    toast.error('当前目录不可写')
    return
  }
  for (const localPath of localPaths) {
    const res = await window.api.sftp.upload(props.sessionId, localPath, path.value)
    if (!res.ok) {
      toast.error(res.error)
      break
    }
  }
  progress.value = null
  await refresh()
}

async function upload(): Promise<void> {
  if (!cwdWritable.value) return
  const files = await window.api.dialog.openFiles()
  if (!files.ok || !files.data.length) return
  await uploadPaths(files.data)
}

async function downloadEntry(entry: SftpEntry): Promise<void> {
  if (entry.isDirectory || !entry.canRead) return
  const dir = await window.api.dialog.openDirectory()
  if (!dir.ok || !dir.data) return
  const res = await window.api.sftp.download(props.sessionId, entry.path, dir.data)
  if (!res.ok) {
    toast.error(res.error)
    return
  }
  progress.value = null
}

async function extractEntry(entry: SftpEntry): Promise<void> {
  if (entry.isDirectory || !isArchive(entry.name) || !entry.canRead || !cwdWritable.value) return
  if (!confirm(`解压 ${entry.name} 到当前目录？`)) return
  extracting.value = true
  try {
    const res = await window.api.sftp.extract(props.sessionId, entry.path)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    await refresh()
  } finally {
    extracting.value = false
  }
}

async function openEditor(entry: SftpEntry, mode: 'preview' | 'edit'): Promise<void> {
  if (entry.isDirectory || !entry.canRead) return
  if (mode === 'edit' && !entry.canWrite) {
    toast.error('没有权限编辑该文件')
    return
  }
  editorOpen.value = true
  editorMode.value = mode
  editorPath.value = entry.path
  editorName.value = entry.name
  editorWritable.value = entry.canWrite
  editorContent.value = ''
  editorOriginal.value = ''
  editorTruncated.value = false
  editorLoading.value = true
  try {
    const res = await window.api.sftp.readText(props.sessionId, entry.path)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    editorContent.value = res.data.content
    editorOriginal.value = res.data.content
    editorTruncated.value = res.data.truncated
  } finally {
    editorLoading.value = false
  }
}

function closeEditor(): void {
  if (
    editorMode.value === 'edit' &&
    editorContent.value !== editorOriginal.value &&
    !confirm('内容已修改，确定关闭？')
  ) {
    return
  }
  editorOpen.value = false
}

async function saveEditor(): Promise<void> {
  if (editorMode.value !== 'edit' || !editorWritable.value) return
  editorSaving.value = true
  try {
    const res = await window.api.sftp.writeText(
      props.sessionId,
      editorPath.value,
      editorContent.value
    )
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    editorOriginal.value = editorContent.value
    editorTruncated.value = false
  } finally {
    editorSaving.value = false
  }
}

function switchToEdit(): void {
  if (!editorWritable.value) return
  editorMode.value = 'edit'
}

function bookmarkAutoLabel(p: string): string {
  if (!p || p === '.') return '主目录'
  if (p === '/') return '根目录'
  const place = COMMON_PLACES.find((x) => x.path === p)
  if (place) return place.label
  const parts = p.replace(/\/+$/, '').split('/').filter(Boolean)
  return parts[parts.length - 1] || p
}

/** 星标：直接收藏/取消当前路径，无弹窗 */
async function toggleBookmark(): Promise<void> {
  if (props.disabled) return
  const existing = currentBookmark.value
  if (existing) {
    await app.deleteBookmark(existing.id)
    return
  }
  await app.saveBookmark({
    id: crypto.randomUUID(),
    label: bookmarkAutoLabel(path.value),
    path: path.value,
    hostId: props.hostId
  })
}

async function removeBookmark(id: string): Promise<void> {
  await app.deleteBookmark(id)
}

function onDragOver(e: DragEvent): void {
  e.preventDefault()
  if (cwdWritable.value) dragOver.value = true
}

function onDragLeave(): void {
  dragOver.value = false
}

async function onDrop(e: DragEvent): Promise<void> {
  e.preventDefault()
  dragOver.value = false
  if (props.disabled || !cwdWritable.value) return
  const files = [...(e.dataTransfer?.files || [])]
  const paths = files
    .map((f) => (f as File & { path?: string }).path)
    .filter((p): p is string => !!p)
  if (!paths.length) {
    toast.error('无法读取拖入文件路径')
    return
  }
  await uploadPaths(paths)
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function fileKind(name: string): 'image' | 'code' | 'archive' | 'text' | 'file' {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'].includes(ext)) return 'image'
  if (['zip', 'tar', 'gz', 'tgz', 'rar', '7z', 'bz2', 'xz'].includes(ext) || isArchive(name))
    return 'archive'
  if (
    [
      'js',
      'ts',
      'vue',
      'json',
      'py',
      'go',
      'rs',
      'java',
      'c',
      'cpp',
      'h',
      'css',
      'scss',
      'html',
      'xml',
      'yml',
      'yaml',
      'sh',
      'bash'
    ].includes(ext)
  )
    return 'code'
  if (['txt', 'md', 'log', 'csv', 'conf', 'cfg', 'ini', 'env'].includes(ext)) return 'text'
  return 'file'
}

function fileKindLabel(name: string, isDirectory: boolean): string {
  if (isDirectory) return '文件夹'
  const kind = fileKind(name)
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  const suffix = ext ? `（.${ext}）` : ''
  const labels: Record<ReturnType<typeof fileKind>, string> = {
    image: '图片文件',
    code: '代码 / 脚本',
    archive: '压缩包',
    text: '文本 / 配置',
    file: '普通文件'
  }
  return `${labels[kind]}${suffix}`
}

function isEntryLocked(entry: SftpEntry): boolean {
  return !entry.canRead
}

function onEntryClick(entry: SftpEntry): void {
  if (isEntryLocked(entry)) return
  selected.value = entry
}

function closeMenus(): void {
  showHistory.value = false
  showPathSuggest.value = false
}

function onDocPointerDown(e: PointerEvent): void {
  if (!showHistory.value && !showPathSuggest.value) return
  const t = e.target as Node
  if (pathFieldRef.value?.contains(t) || historyMenuRef.value?.contains(t)) return
  closeMenus()
}

onMounted(async () => {
  document.addEventListener('pointerdown', onDocPointerDown, true)
  offProgress = window.api.sftp.onProgress((p) => {
    if (p.sessionId === props.sessionId) progress.value = p
  })
  await refresh()
  pushHistory(path.value)
  syncPathDraft()
})

watch(
  () => props.sessionId,
  async () => {
    path.value = '.'
    selected.value = null
    pathHistory.value = []
    closeMenus()
    editorOpen.value = false
    await refresh()
    pushHistory(path.value)
    syncPathDraft()
  }
)

onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocPointerDown, true)
  offProgress?.()
})
</script>

<template>
  <div
    class="sftp"
    :class="{ disabled, dragOver }"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <div class="path-bar">
      <GlassTip text="返回上级目录" mode="wrap">
        <button
          type="button"
          class="btn-icon sm"
          :disabled="!parentPath || disabled"
          @click="goParent"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"
            />
          </svg>
        </button>
      </GlassTip>
      <div ref="pathFieldRef" class="path-field">
        <GlassTip
          text="点击输入路径或 cd 命令，回车跳转；失焦恢复显示当前路径"
          mode="wrap"
        >
          <input
            ref="pathInputEl"
            v-model="pathDraft"
            class="path-input"
            type="text"
            spellcheck="false"
            :disabled="disabled"
            :class="{ editing: pathEditing }"
            placeholder="cd /a/b/c 或 /绝对路径"
            @focus="onPathFocus"
            @blur="onPathBlur"
            @keydown.enter.prevent="submitPathDraft"
          />
        </GlassTip>
        <div
          v-if="showPathSuggest && !disabled"
          class="hist-menu path-suggest"
          @mousedown.prevent
        >
          <div class="hist-sec">常用</div>
          <button
            v-for="place in COMMON_PLACES"
            :key="place.path"
            type="button"
            class="hist-item hist-row"
            :class="{ active: place.path === path }"
            @click="pickSuggestPath(place.path)"
          >
            <span class="hist-name">{{ place.label }}</span>
            <span class="hist-sub">{{ placeDisplayPath(place.path) }}</span>
          </button>
          <div class="hist-sec">收藏 <GlassTip text="右键收藏项可取消收藏" /></div>
          <button
            v-for="b in bookmarks"
            :key="b.id"
            type="button"
            class="hist-item hist-row"
            :class="{ active: b.path === path }"
            @click="pickBookmark(b)"
            @contextmenu.prevent="removeBookmark(b.id)"
          >
            <span class="hist-name">{{ b.label }}</span>
            <span class="hist-sub">{{ placeDisplayPath(b.path) }}</span>
          </button>
          <div v-if="!bookmarks.length" class="hist-empty">点击星标收藏当前路径</div>
        </div>
      </div>
      <GlassTip text="刷新当前目录" mode="wrap">
        <button type="button" class="btn-icon sm" :disabled="disabled" @click="refresh">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M12 6V3L8 7l4 4V8c2.76 0 5 2.24 5 5 0 .87-.22 1.68-.62 2.38l1.47 1.47A6.97 6.97 0 0 0 19 13c0-3.87-3.13-7-7-7zm-5 5c0-.87.22-1.68.62-2.38L5.15 7.15A6.97 6.97 0 0 0 5 13c0 3.87 3.13 7 7 7v3l4-4-4-4v3c-2.76 0-5-2.24-5-5z"
            />
          </svg>
        </button>
      </GlassTip>

      <div class="path-tools">
        <GlassTip :text="cwdWritable ? '新建文件夹' : '当前目录不可写'" mode="wrap">
          <button
            type="button"
            class="btn-icon sm"
            :disabled="disabled || !cwdWritable"
            @click="mkdir"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2zm4 9h2v2h-2v2h-2v-2h-2v-2h2v-2h2v2z"
              />
            </svg>
          </button>
        </GlassTip>
        <GlassTip :text="cwdWritable ? '上传到当前目录' : '当前目录不可写'" mode="wrap">
          <button
            type="button"
            class="btn-icon sm"
            :disabled="disabled || !cwdWritable"
            @click="upload"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path fill="currentColor" d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z" />
            </svg>
          </button>
        </GlassTip>
        <GlassTip
          :text="currentBookmark ? '取消收藏当前路径' : '收藏当前路径'"
          mode="wrap"
        >
          <button
            type="button"
            class="btn-icon sm"
            :class="{ active: !!currentBookmark }"
            :disabled="disabled"
            @click="toggleBookmark"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"
              />
            </svg>
          </button>
        </GlassTip>
        <div ref="historyMenuRef" class="hist-wrap">
          <GlassTip text="浏览历史" mode="wrap">
            <button
              type="button"
              class="btn-icon sm"
              :disabled="disabled || pathHistory.length < 2"
              @click="toggleHistory"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6a7 7 0 0 1 7-7 7 7 0 0 1 7 7 7 7 0 0 1-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.95 8.95 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"
                />
              </svg>
            </button>
          </GlassTip>
          <div v-if="showHistory" class="hist-menu">
            <button
              v-for="(h, i) in pathHistory"
              :key="h + i"
              type="button"
              class="hist-item"
              :class="{ active: h === path }"
              @click="goPath(h)"
            >
              {{ historyLabel(h) }}
            </button>
          </div>
        </div>
        <span v-if="!cwdWritable" class="perm-hint">只读</span>
      </div>
    </div>

    <div class="table-wrap">
      <div v-if="loading" class="sftp-skeleton" aria-busy="true" aria-label="加载中">
        <div v-for="n in 8" :key="n" class="sk-row">
          <div class="sk-ico" />
          <div class="sk-lines">
            <div class="sk-line name" />
            <div class="sk-line meta" />
          </div>
        </div>
      </div>
      <table v-else>
        <thead>
          <tr>
            <th class="col-name">名称</th>
            <th class="col-size">大小</th>
            <th class="col-time">修改时间</th>
            <th class="col-ops" />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="entry in sortedEntries"
            :key="entry.path"
            :class="{
              selected: selected?.path === entry.path,
              dir: entry.isDirectory,
              locked: isEntryLocked(entry),
              'hover-reveal-host': !isEntryLocked(entry),
              'keep-reveal': !isEntryLocked(entry) && selected?.path === entry.path
            }"
            @click="onEntryClick(entry)"
            @dblclick="openEntry(entry)"
          >
            <td class="col-name">
              <div class="name-cell">
                <GlassTip :text="fileKindLabel(entry.name, entry.isDirectory)" mode="wrap">
                  <span
                    class="entry-ico"
                    :class="entry.isDirectory ? 'folder' : fileKind(entry.name)"
                  >
                    <svg v-if="entry.isDirectory" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        fill="currentColor"
                        d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"
                      />
                    </svg>
                    <svg v-else viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        fill="currentColor"
                        d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"
                      />
                    </svg>
                  </span>
                </GlassTip>
                <GlassTip :text="entry.name" mode="wrap">
                  <span class="entry-name">{{ entry.name }}</span>
                </GlassTip>
              </div>
            </td>
            <td class="col-size">{{ entry.isDirectory ? '—' : formatSize(entry.size) }}</td>
            <td class="col-time">
              {{ entry.modifyTime ? new Date(entry.modifyTime).toLocaleString() : '—' }}
            </td>
            <td class="col-ops">
              <div v-if="!isEntryLocked(entry)" class="row-ops hover-reveal" @click.stop>
                <GlassTip
                  v-if="!entry.isDirectory"
                  :text="entry.canRead ? '预览' : '无读取权限'"
                  mode="wrap"
                >
                  <button
                    type="button"
                    class="op"
                    :disabled="!entry.canRead"
                    @click="openEditor(entry, 'preview')"
                  >
                    预览
                  </button>
                </GlassTip>
                <GlassTip
                  v-if="!entry.isDirectory"
                  :text="!entry.canRead ? '无读取权限' : !entry.canWrite ? '无写入权限' : '编辑'"
                  mode="wrap"
                >
                  <button
                    type="button"
                    class="op"
                    :disabled="!entry.canRead || !entry.canWrite"
                    @click="openEditor(entry, 'edit')"
                  >
                    编辑
                  </button>
                </GlassTip>
                <GlassTip
                  v-if="!entry.isDirectory"
                  :text="entry.canRead ? '下载' : '无读取权限'"
                  mode="wrap"
                >
                  <button
                    type="button"
                    class="op"
                    :disabled="!entry.canRead"
                    @click="downloadEntry(entry)"
                  >
                    下载
                  </button>
                </GlassTip>
                <GlassTip
                  v-if="!entry.isDirectory && isArchive(entry.name)"
                  :text="
                    !entry.canRead
                      ? '无读取权限'
                      : !cwdWritable
                        ? '当前目录不可写'
                        : '解压到当前目录'
                  "
                  mode="wrap"
                >
                  <button
                    type="button"
                    class="op"
                    :disabled="!entry.canRead || !cwdWritable || extracting"
                    @click="extractEntry(entry)"
                  >
                    解压
                  </button>
                </GlassTip>
                <GlassTip :text="cwdWritable ? '重命名' : '当前目录不可写'" mode="wrap">
                  <button
                    type="button"
                    class="op"
                    :disabled="!cwdWritable"
                    @click="renameEntry(entry)"
                  >
                    重命名
                  </button>
                </GlassTip>
                <GlassTip :text="cwdWritable ? '删除' : '当前目录不可写'" mode="wrap">
                  <button
                    type="button"
                    class="op danger"
                    :disabled="!cwdWritable"
                    @click="removeEntry(entry)"
                  >
                    删除
                  </button>
                </GlassTip>
              </div>
            </td>
          </tr>
          <tr v-if="!loading && !sortedEntries.length">
            <td colspan="4" class="empty">此目录为空</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="sftp-toasts" aria-live="polite">
      <Transition name="toast">
        <GlassStatusToast
          v-if="progress"
          :key="'prog'"
          type="info"
          :text="`${progress.direction === 'upload' ? '上传' : '下载'} ${progress.filename}：${Math.min(100, Math.round((progress.transferred / Math.max(progress.total, 1)) * 100))}%`"
        />
      </Transition>
      <Transition name="toast">
        <GlassStatusToast v-if="extracting" key="extract" type="info" text="正在解压…" />
      </Transition>
      <Transition name="toast">
        <GlassStatusToast
          v-if="dragOver"
          key="drop"
          type="info"
          text="松开以上传到当前目录"
        />
      </Transition>
    </div>

    <div v-if="namePrompt" class="name-prompt-mask" @click.self="cancelNamePrompt">
      <div class="name-prompt glass-panel" role="dialog" aria-modal="true">
        <div class="name-prompt-title">{{ namePrompt.title }}</div>
        <input
          ref="namePromptInput"
          v-model="namePrompt.value"
          class="glass-field"
          type="text"
          spellcheck="false"
          placeholder="输入名称"
          @keydown.enter.prevent="submitNamePrompt"
          @keydown.esc.prevent="cancelNamePrompt"
        />
        <div class="name-prompt-actions">
          <button type="button" class="btn-glass sm" @click="cancelNamePrompt">取消</button>
          <button type="button" class="btn-accent sm" @click="submitNamePrompt">确定</button>
        </div>
      </div>
    </div>

    <div v-if="editorOpen" class="editor-mask" @click.self="closeEditor">
      <div class="editor-panel glass-panel">
        <div class="editor-top">
          <div class="editor-title">
            <strong>{{ editorMode === 'edit' ? '编辑' : '预览' }}</strong>
            <GlassTip :text="editorPath" mode="wrap">
              <span class="editor-path">{{ editorName }}</span>
            </GlassTip>
            <span v-if="editorTruncated" class="warn">内容过大已截断</span>
          </div>
          <div class="editor-actions">
            <button
              v-if="editorMode === 'preview' && editorWritable"
              type="button"
              class="btn-glass sm"
              :disabled="editorLoading"
              @click="switchToEdit"
            >
              编辑
            </button>
            <button
              v-if="editorMode === 'edit'"
              type="button"
              class="btn-accent sm"
              :disabled="editorLoading || editorSaving || editorContent === editorOriginal"
              @click="saveEditor"
            >
              {{ editorSaving ? '保存中…' : '保存' }}
            </button>
            <button type="button" class="btn-glass sm" @click="closeEditor">关闭</button>
          </div>
        </div>
        <p v-if="editorLoading" class="hint">读取中…</p>
        <textarea
          v-else
          v-model="editorContent"
          class="editor-body"
          :readonly="editorMode === 'preview'"
          spellcheck="false"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.sftp {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: transparent;
  position: relative;
}

.sftp.disabled {
  opacity: 0.55;
  pointer-events: none;
}

.sftp.dragOver::after {
  content: '';
  position: absolute;
  inset: 8px;
  border: 2px dashed var(--accent);
  border-radius: 14px;
  background: var(--accent-soft);
  pointer-events: none;
  z-index: 5;
}

.path-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--glass-border);
  background: rgba(255, 255, 255, 0.03);
  flex-wrap: wrap;
}

.path-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-left: 2px;
}

.hist-wrap {
  position: relative;
}

.hist-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 220px;
  max-width: min(420px, 70vw);
  max-height: 320px;
  overflow: auto;
  padding: 8px;
  border-radius: 12px;
  border: 1px solid var(--glass-border);
  background: color-mix(in srgb, #0b1522 92%, transparent);
  backdrop-filter: blur(16px);
  box-shadow: var(--glass-shadow);
}

.hist-item {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  width: 100%;
  min-height: 36px;
  text-align: left;
  border: 0;
  background: transparent;
  color: var(--text);
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.4;
  font-family: var(--mono);
  box-sizing: border-box;
  transform: none !important;
}

.hist-item:hover,
.hist-item.active {
  background: var(--accent-soft);
  color: var(--accent-hover);
}

.hist-sec {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--text-muted);
  user-select: none;
}

.hist-sec {
  position: relative;
  flex: 1;
  min-width: 120px;
}

.path-field :deep(.glass-tip.wrap) {
  display: block;
  width: 100%;
}

.path-input {
  width: 100%;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--glass-border);
  border-radius: 12px;
  background: var(--glass-bg-input);
  color: var(--text);
  font-family: var(--mono);
  font-size: 12px;
  outline: none;
  box-sizing: border-box;
}

.path-input.editing {
  border-color: var(--accent);
}

.path-input:focus {
  border-color: var(--glass-border-strong);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.path-input:disabled {
  opacity: 0.55;
}

.path-input::placeholder {
  color: var(--text-muted);
  opacity: 0.7;
}

.path-suggest {
  left: 0;
  right: 0;
  top: calc(100% + 6px);
  min-width: 0;
  max-width: none;
  max-height: min(360px, 50vh);
}

.hist-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  overflow: hidden;
}

.hist-name {
  flex-shrink: 0;
  font-family: inherit;
  font-weight: 500;
}

.hist-sub {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--text-muted);
  font-family: var(--mono);
}

.hist-item.active .hist-sub,
.hist-item:hover .hist-sub {
  color: var(--accent-hover);
  opacity: 0.85;
}

.actions {
  display: none;
}

.action-group {
  display: none;
}

.perm-hint {
  font-size: 12px;
  color: var(--text-muted);
}

.bookmarks {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--glass-border);
}

.bm-label {
  font-size: 11px;
  color: var(--text-muted);
  margin-right: 2px;
}

.chip {
  border: 1px solid var(--glass-border);
  background: var(--accent-soft);
  color: var(--accent-hover);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
}

.table-wrap {
  flex: 1;
  overflow: auto;
  position: relative;
}

.hist-item.add {
  color: var(--accent-hover);
  font-weight: 600;
  border-bottom: 1px solid var(--glass-border);
  border-radius: 8px 8px 0 0;
  margin-bottom: 4px;
}

.hist-empty {
  padding: 10px;
  font-size: 12px;
  color: var(--text-muted);
}

.sftp-skeleton {
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sk-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.sk-ico,
.sk-line {
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.06) 0%,
    rgba(255, 255, 255, 0.12) 45%,
    rgba(255, 255, 255, 0.06) 90%
  );
  background-size: 200% 100%;
  animation: sftp-sk 1.35s ease-in-out infinite;
  border-radius: 8px;
}

.sk-ico {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
}

.sk-lines {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sk-line.name {
  height: 12px;
  width: 42%;
}

.sk-line.meta {
  height: 10px;
  width: 28%;
  opacity: 0.7;
}

@keyframes sftp-sk {
  0% {
    background-position: 120% 0;
  }
  100% {
    background-position: -80% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .sk-ico,
  .sk-line {
    animation: none;
  }
}

.overlay-hint {
  display: none;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  table-layout: fixed;
}

th,
td {
  text-align: left;
  padding: 9px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

th {
  position: sticky;
  top: 0;
  background: rgba(8, 14, 22, 0.88);
  backdrop-filter: blur(12px);
  color: var(--text-muted);
  font-weight: 600;
  z-index: 1;
}

.col-size {
  width: 88px;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
}

.col-time {
  width: 160px;
  font-size: 12px;
  color: var(--text-muted);
}

.col-ops {
  width: 280px;
  padding-right: 10px;
}

.name-cell {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

tr {
  cursor: default;
}

tr.dir {
  cursor: pointer;
}

tr.locked {
  opacity: 0.48;
  color: var(--text-muted);
  cursor: not-allowed;
  pointer-events: none;
}

tr.locked .entry-ico {
  color: var(--text-muted) !important;
  filter: grayscale(1);
}

tr.locked .entry-name,
tr.locked .col-size,
tr.locked .col-time {
  color: var(--text-muted);
}

tr.locked:hover {
  background: transparent;
}

tr.selected,
tr:hover {
  background: var(--accent-soft);
}

.entry-ico {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
}

.entry-ico svg {
  width: 18px;
  height: 18px;
}

.entry-ico.folder {
  color: #f0b429;
}

.entry-ico.file {
  color: #8ab4f8;
}

.entry-ico.image {
  color: #7dffa8;
}

.entry-ico.code {
  color: #c4b5fd;
}

.entry-ico.archive {
  color: #fb7185;
}

.entry-ico.text {
  color: #38bdf8;
}

.entry-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-ops {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 4px;
}

.row-ops :deep(.glass-tip.wrap) {
  display: inline-flex;
}

.name-cell :deep(.glass-tip.wrap:first-child) {
  display: inline-flex;
  flex-shrink: 0;
}

.name-cell :deep(.glass-tip.wrap:last-child) {
  display: block;
  min-width: 0;
  flex: 1;
  overflow: hidden;
}

.op {
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  border-radius: 8px;
  padding: 3px 8px;
  font-size: 11px;
  color: var(--text);
}

.op:hover:not(:disabled) {
  background: var(--glass-bg-strong);
}

.op:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.op.danger {
  color: var(--danger);
}

.empty {
  text-align: center;
  color: var(--text-muted);
  padding: 28px 14px !important;
}

.error {
  color: var(--danger);
}

.hint {
  color: var(--text-muted);
}

.sftp-toasts {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 12px;
  z-index: 25;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}

.sftp-toasts :deep(.glass-status-toast) {
  pointer-events: auto;
}

.name-prompt-mask {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(4px);
}

.name-prompt {
  width: min(360px, 100%);
  padding: 18px 16px 14px;
  border-radius: 16px;
}

.name-prompt-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 12px;
}

.name-prompt .glass-field {
  width: 100%;
  box-sizing: border-box;
}

.name-prompt-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

.editor-mask {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: stretch;
  justify-content: center;
  padding: 12px;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(4px);
}

.editor-panel {
  display: flex;
  flex-direction: column;
  width: min(920px, 100%);
  max-height: 100%;
  overflow: hidden;
  border-radius: 16px;
}

.editor-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 14px;
  border-bottom: 1px solid var(--glass-border);
  flex-shrink: 0;
}

.editor-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}

.editor-path {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.editor-actions {
  display: flex;
  gap: 6px;
}

.warn {
  font-size: 11px;
  color: #fbbf24;
}

.editor-err {
  margin: 8px 14px 0;
}

.editor-body {
  flex: 1;
  min-height: 280px;
  width: 100%;
  margin: 0;
  padding: 14px;
  border: 0;
  resize: none;
  background: transparent;
  color: var(--text);
  font-family: var(--mono);
  font-size: 13px;
  line-height: 1.55;
  outline: none;
}
</style>
