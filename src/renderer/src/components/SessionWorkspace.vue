<script setup lang="ts">
import { computed } from 'vue'
import { TAB_COLORS } from '../../../shared/types'
import { useSessionStore } from '../stores/session'
import TerminalPanel from './TerminalPanel.vue'
import SftpView from './SftpView.vue'
import MetricsView from './MetricsView.vue'
import GlassTip from './ui/GlassTip.vue'
import { useToastStore } from '../stores/toast'

const sessions = useSessionStore()
const toasts = useToastStore()

const colorValue = computed(() => {
  const id = sessions.activeTab?.color || 'default'
  return TAB_COLORS.find((c) => c.id === id)?.value || '#6cb6ff'
})

async function closeTab(sessionId: string, e: Event): Promise<void> {
  e.stopPropagation()
  await sessions.closeTab(sessionId)
}

async function newConnection(): Promise<void> {
  try {
    await sessions.connectSameHost()
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    toasts.error(msg, 8000)
  }
}
</script>

<template>
  <main class="workspace glass-panel">
    <div class="inner">
      <div v-if="!sessions.tabs.length" class="empty">
        <div class="empty-mark">SSH</div>
        <h2>准备连接</h2>
        <p>从左侧选择主机开始。每个标签代表一条 SSH 连接，可在连接内切换终端、SFTP 与监控。</p>
      </div>

      <template v-else>
        <div class="chrome">
          <div class="btn-tab-list">
            <GlassTip
              v-for="tab in sessions.tabs"
              :key="tab.sessionId"
              :text="tab.note || tab.title"
              mode="wrap"
            >
              <button
                type="button"
                class="btn-tab hover-reveal-host"
                :class="{ active: tab.sessionId === sessions.activeSessionId, closed: tab.closed }"
                :style="{ '--tab-color': TAB_COLORS.find((c) => c.id === tab.color)?.value }"
                @click="sessions.setActive(tab.sessionId)"
              >
                <span class="dot" />
                <span class="label">{{ tab.title }}</span>
                <span v-if="tab.reconnecting" class="badge">重连中</span>
                <span v-else-if="tab.closed" class="badge">已断开</span>
                <span class="close hover-reveal hover-reveal-inline" @click="closeTab(tab.sessionId, $event)">×</span>
              </button>
            </GlassTip>
          </div>

          <GlassTip text="为当前主机再建一条 SSH 连接" mode="wrap">
            <button
              type="button"
              class="btn-glass sm new-conn"
              :disabled="!sessions.activeTab || sessions.activeTab.closed || sessions.connecting"
              @click="newConnection"
            >
              + 新连接
            </button>
          </GlassTip>
        </div>

        <div class="content" :style="{ borderColor: colorValue }">
          <div v-if="sessions.activeTab" class="workspace-nav">
            <div class="nav-left">
              <span class="conn-label">{{ sessions.activeTab.title }}</span>
              <span class="nav-sep">·</span>
              <div class="btn-segment">
                <button
                  type="button"
                  :class="{ active: sessions.panel === 'terminal' }"
                  @click="sessions.setPanel('terminal')"
                >
                  终端
                </button>
                <button
                  type="button"
                  :class="{ active: sessions.panel === 'sftp' }"
                  @click="sessions.setPanel('sftp')"
                >
                  SFTP
                </button>
                <button
                  type="button"
                  :class="{ active: sessions.panel === 'metrics' }"
                  @click="sessions.setPanel('metrics')"
                >
                  监控
                </button>
              </div>
            </div>

            <GlassTip text="命令片段" mode="wrap">
              <button
                type="button"
                class="btn-glass sm"
                :disabled="sessions.activeTab.closed || sessions.panel !== 'terminal'"
                @click="sessions.showSnippets = true"
              >
                片段
              </button>
            </GlassTip>
          </div>

          <div class="panes">
            <template v-for="tab in sessions.tabs" :key="tab.sessionId">
              <TerminalPanel
                v-show="tab.sessionId === sessions.activeSessionId && sessions.panel === 'terminal'"
                class="pane"
                :tab="tab"
                :active="tab.sessionId === sessions.activeSessionId && sessions.panel === 'terminal'"
              />
              <div
                v-show="tab.sessionId === sessions.activeSessionId && sessions.panel === 'sftp'"
                class="pane"
              >
                <SftpView
                  v-if="tab.sessionId === sessions.activeSessionId"
                  :session-id="tab.sessionId"
                  :host-id="tab.hostId"
                  :disabled="tab.closed"
                />
              </div>
              <div
                v-show="tab.sessionId === sessions.activeSessionId && sessions.panel === 'metrics'"
                class="pane"
              >
                <MetricsView
                  v-if="tab.sessionId === sessions.activeSessionId"
                  :session-id="tab.sessionId"
                  :active="
                    tab.sessionId === sessions.activeSessionId && sessions.panel === 'metrics'
                  "
                  :disabled="tab.closed"
                />
              </div>
            </template>
          </div>
        </div>
      </template>
    </div>
  </main>
</template>

<style scoped>
.workspace {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.inner {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.empty {
  margin: auto;
  text-align: center;
  color: var(--text-muted);
  padding: 48px 24px;
  max-width: 420px;
}

.empty-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  margin-bottom: 16px;
  border-radius: 18px;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #041018;
  background: linear-gradient(160deg, #c8e4ff, var(--accent));
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.5) inset,
    0 12px 30px rgba(80, 150, 230, 0.3);
}

.empty h2 {
  margin: 0 0 8px;
  color: var(--text);
  font-size: 26px;
  letter-spacing: -0.03em;
}

.chrome {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 12px 0;
  flex-wrap: wrap;
}

.btn-tab-list :deep(.glass-tip.wrap) {
  display: inline-flex;
  flex-shrink: 0;
}

.new-conn {
  flex-shrink: 0;
}

.content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin: 10px;
  border-radius: 18px;
  overflow: hidden;
  border: 1px solid var(--glass-border);
  background: rgba(0, 0, 0, 0.28);
}

.workspace-nav {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--glass-border);
  background: rgba(255, 255, 255, 0.03);
}

.nav-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

.conn-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
}

.nav-sep {
  color: var(--text-muted);
  opacity: 0.6;
  font-size: 13px;
}

.panes {
  flex: 1;
  min-height: 0;
  position: relative;
}

.pane {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
</style>
