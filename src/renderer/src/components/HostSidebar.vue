<script setup lang="ts">
import { computed, ref, toRaw } from 'vue'
import type { HostConfig } from '../../../shared/types'
import { useAppStore } from '../stores/app'
import { useSessionStore } from '../stores/session'
import { useToastStore } from '../stores/toast'
import HostFormModal from './HostFormModal.vue'
import GlassTip from './ui/GlassTip.vue'

const emit = defineEmits<{
  openSettings: []
  openTrash: []
  lock: []
}>()

const app = useAppStore()
const sessions = useSessionStore()
const toasts = useToastStore()
const query = ref('')
const editing = ref<HostConfig | null>(null)
const showForm = ref(false)

const colorMap: Record<string, string> = {
  default: '#6cb6ff',
  blue: '#5b9dff',
  teal: '#2dd4bf',
  amber: '#fbbf24',
  rose: '#fb7185',
  violet: '#a78bfa',
  lime: '#a3e635'
}

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  const list = [...app.hosts].sort((a, b) => (b.lastConnectedAt ?? 0) - (a.lastConnectedAt ?? 0))
  if (!q) return list
  return list.filter(
    (h) =>
      h.name.toLowerCase().includes(q) ||
      h.host.toLowerCase().includes(q) ||
      (h.group || '').toLowerCase().includes(q)
  )
})

function openCreate(): void {
  editing.value = null
  showForm.value = true
}

function openEdit(host: HostConfig): void {
  editing.value = structuredClone(toRaw(host))
  showForm.value = true
}

async function removeHost(host: HostConfig): Promise<void> {
  if (!confirm(`将主机「${host.name}」移入回收站？`)) return
  await app.deleteHost(host.id)
}

function formatConnectError(raw: string): string {
  const msg = raw.trim()
  if (/authentication methods failed/i.test(msg) || /All configured authentication/i.test(msg)) {
    return '登录失败：用户名或密码/密钥不正确，或服务器禁止了当前认证方式。请点编辑图标核对后重试。'
  }
  if (/Timed out|ETIMEDOUT|ECONNREFUSED|ENOTFOUND/i.test(msg)) {
    return `无法连接主机：${msg}`
  }
  return msg
}

async function connect(host: HostConfig): Promise<void> {
  if (sessions.connecting) return
  try {
    await sessions.connect(host.id)
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error)
    toasts.error(formatConnectError(raw), 8000)
  }
}

function isConnecting(host: HostConfig): boolean {
  return sessions.connectingHostId === host.id
}

async function importConfig(): Promise<void> {
  toasts.info(await app.importSshConfig())
}

async function importCsv(): Promise<void> {
  toasts.info(await app.importCsv())
}
</script>

<template>
  <aside class="sidebar glass-panel">
    <div class="inner">
      <header>
        <div>
          <div class="eyebrow">Library</div>
          <div class="title">主机</div>
        </div>
        <div class="actions">
          <GlassTip text="回收站" mode="wrap">
            <button class="btn-glass sm" @click="emit('openTrash')">
              回收站{{ app.trash.length ? `(${app.trash.length})` : '' }}
            </button>
          </GlassTip>
          <GlassTip text="设置" mode="wrap">
            <button class="btn-glass sm" @click="emit('openSettings')">设置</button>
          </GlassTip>
          <GlassTip v-if="app.vault.protection !== 'os'" text="锁定" mode="wrap">
            <button class="btn-glass sm" @click="emit('lock')">锁定</button>
          </GlassTip>
        </div>
      </header>

      <div class="toolbar">
        <input v-model="query" class="glass-field search" placeholder="搜索主机…" />
        <GlassTip text="添加主机" mode="wrap">
          <button type="button" class="btn-icon accent" @click="openCreate">+</button>
        </GlassTip>
      </div>
      <div class="import-row">
        <button class="btn-glass sm" @click="importConfig">导入 Config</button>
        <button class="btn-glass sm" @click="importCsv">导入 CSV</button>
      </div>

      <div class="list-wrap">
        <div class="list">
        <div
          v-for="host in filtered"
          :key="host.id"
          class="host hover-reveal-host"
          :class="{
            connecting: isConnecting(host),
            busy: sessions.connecting
          }"
          role="button"
          tabindex="0"
          @click="connect(host)"
          @keydown.enter.prevent="connect(host)"
          @keydown.space.prevent="connect(host)"
        >
          <div class="row">
            <GlassTip text="点击连接" mode="wrap">
              <div class="host-main">
                <span class="name-line">
                  <span class="dot" :style="{ background: colorMap[host.color || 'default'] }" />
                  <strong>{{ host.name }}</strong>
                  <span v-if="isConnecting(host)" class="status">正在连接…</span>
                  <span v-else-if="host.group" class="group">{{ host.group }}</span>
                </span>
                <div class="meta">{{ host.username }}@{{ host.host }}:{{ host.port }}</div>
              </div>
            </GlassTip>
            <div class="ops hover-reveal" @click.stop>
              <GlassTip text="编辑" mode="wrap">
                <button
                  type="button"
                  class="btn-icon xs"
                  aria-label="编辑"
                  @click="openEdit(host)"
                >
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M14.1 5.4 18.6 9.9M4 20l3.2-.7c.3-.1.6-.2.8-.4L19.5 7.4a2.1 2.1 0 0 0 0-3L19.6 4a2.1 2.1 0 0 0-3 0L5.1 15.5c-.2.2-.4.5-.4.8L4 20Z"
                      stroke="currentColor"
                      stroke-width="1.7"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </button>
              </GlassTip>
              <GlassTip text="删除" mode="wrap">
                <button
                  type="button"
                  class="btn-icon xs danger"
                  aria-label="删除"
                  @click="removeHost(host)"
                >
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M5 7h14M10 11v6M14 11v6M8.5 7l.6-2.2A1 1 0 0 1 10.1 4h3.8a1 1 0 0 1 1 .8L15.5 7M7 7l.8 11.2A1.5 1.5 0 0 0 9.3 19.5h5.4a1.5 1.5 0 0 0 1.5-1.3L17 7"
                      stroke="currentColor"
                      stroke-width="1.7"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </button>
              </GlassTip>
            </div>
          </div>
          <div v-if="host.note" class="note">{{ host.note }}</div>
          <div class="auth">
            {{ host.authType === 'password' ? '密码' : '私钥' }}
            <template v-if="host.jumpHostId"> · 跳板</template>
          </div>
        </div>
        <div v-if="!filtered.length" class="empty">暂无主机，点击 + 添加</div>
        </div>
      </div>
    </div>
  </aside>

  <HostFormModal
    v-if="showForm"
    :host="editing"
    @close="showForm = false"
    @saved="showForm = false"
  />
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.inner {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  min-width: 0;
}

header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 18px 16px 10px;
  gap: 10px;
}

.eyebrow {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 2px;
}

.title {
  font-weight: 700;
  font-size: 22px;
  letter-spacing: -0.03em;
}

.actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
  max-width: 180px;
}

.toolbar {
  display: flex;
  gap: 8px;
  padding: 0 14px 12px;
}

.search {
  flex: 1;
  min-width: 0;
}

.import-row {
  display: flex;
  gap: 6px;
  padding: 0 14px 10px;
}

.import-row .btn-glass {
  flex: 1;
  min-width: 0;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.note {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.list-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.list {
  flex: 1;
  overflow: auto;
  padding: 0 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.host-main :deep(.glass-tip.wrap) {
  display: block;
  min-width: 0;
  width: 100%;
}

.ops :deep(.glass-tip.wrap) {
  display: inline-flex;
  flex-shrink: 0;
}

.host {
  position: relative;
  display: flex;
  flex-direction: column;
  text-align: left;
  padding: 11px 12px;
  border: 1px solid transparent;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.03);
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  overflow: hidden;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.host.connecting {
  border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  background: var(--accent-soft);
}

.host.busy {
  cursor: wait;
}

.host:hover {
  background: var(--glass-bg-strong);
  border-color: var(--glass-border);
}

.host:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent) 55%, transparent);
  outline-offset: 2px;
}

.row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: flex-start;
  min-width: 0;
}

.host-main {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.name-line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  overflow: hidden;
}

.name-line strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status {
  flex-shrink: 0;
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  color: var(--accent-hover);
  line-height: 1.2;
}

.group {
  flex-shrink: 0;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent-hover);
}

.meta {
  margin-top: 5px;
  font-size: 12px;
  color: var(--text-muted);
  font-family: var(--mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.auth {
  margin-top: 6px;
  font-size: 11px;
  color: var(--text-muted);
}

.ops {
  position: absolute;
  top: 9px;
  right: 9px;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 4px;
  z-index: 2;
}

.empty {
  padding: 8px 16px;
  font-size: 13px;
  color: var(--text-muted);
  word-break: break-word;
}
</style>
