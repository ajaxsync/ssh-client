<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import { TAB_COLORS } from "../../../shared/types";
import { useSessionStore } from "../stores/session";
import { useAppStore } from "../stores/app";
import TerminalPanel from "./TerminalPanel.vue";
import SftpView from "./SftpView.vue";
import MetricsView from "./MetricsView.vue";
import GlassTip from "./ui/GlassTip.vue";
import { useToastStore } from "../stores/toast";

const sessions = useSessionStore();
const app = useAppStore();
const toasts = useToastStore();

const showCmdHistory = ref(false);
const cmdHistory = ref<string[]>([]);
const cmdHistWrap = ref<HTMLElement | null>(null);

const colorValue = computed(() => {
  const id = sessions.activeTab?.color || "default";
  return TAB_COLORS.find((c) => c.id === id)?.value || "#6cb6ff";
});

async function closeTab(sessionId: string, e: Event): Promise<void> {
  e.stopPropagation();
  await sessions.closeTab(sessionId);
}

async function newConnection(): Promise<void> {
  try {
    await sessions.connectSameHost();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    toasts.error(msg, 8000);
  }
}

function onDocPointerDown(e: PointerEvent): void {
  const t = e.target as Node | null;
  if (cmdHistWrap.value?.contains(t)) return;
  showCmdHistory.value = false;
}

async function toggleCmdHistory(): Promise<void> {
  if (showCmdHistory.value) {
    showCmdHistory.value = false;
    document.removeEventListener("pointerdown", onDocPointerDown, true);
    return;
  }
  const hostId = sessions.activeTab?.hostId;
  if (!hostId) return;
  cmdHistory.value = await app.listCommandHistory(hostId);
  showCmdHistory.value = true;
  document.addEventListener("pointerdown", onDocPointerDown, true);
}

function copyCommand(cmd: string): void {
  window.api.clipboard.writeText(cmd);
  showCmdHistory.value = false;
  document.removeEventListener("pointerdown", onDocPointerDown, true);
  toasts.success("指令已复制");
}

onUnmounted(() => {
  document.removeEventListener("pointerdown", onDocPointerDown, true);
});
</script>

<template>
  <main class="workspace glass-panel">
    <div class="inner">
      <div v-if="!sessions.tabs.length" class="empty">
        <img class="empty-logo" src="/favicon.png" alt="SSH Client Plus" />
        <h2>准备连接</h2>
        <p>
          从左侧选择主机开始。每个标签代表一条 SSH
          连接，可在连接内切换终端、SFTP 与监控。
        </p>
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
                :class="{
                  active: tab.sessionId === sessions.activeSessionId,
                  closed: tab.closed,
                }"
                :style="{
                  '--tab-color': TAB_COLORS.find((c) => c.id === tab.color)
                    ?.value,
                }"
                @click="sessions.setActive(tab.sessionId)"
              >
                <span class="dot" />
                <span class="label">{{ tab.title }}</span>
                <span v-if="tab.reconnecting" class="badge">重连中</span>
                <span v-else-if="tab.closed" class="badge">已断开</span>
                <span
                  class="close hover-reveal hover-reveal-inline"
                  @click="closeTab(tab.sessionId, $event)"
                  >×</span
                >
              </button>
            </GlassTip>
          </div>

          <GlassTip text="为当前主机再建一条 SSH 连接" mode="wrap">
            <button
              type="button"
              class="btn-glass sm new-conn"
              :disabled="
                !sessions.activeTab ||
                sessions.activeTab.closed ||
                sessions.connecting
              "
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

            <div ref="cmdHistWrap" class="cmd-hist-wrap">
              <GlassTip text="当前主机的命令历史" mode="wrap">
                <button
                  type="button"
                  class="btn-glass sm"
                  :disabled="sessions.activeTab.closed"
                  @click="toggleCmdHistory"
                >
                  历史
                </button>
              </GlassTip>
              <div v-if="showCmdHistory" class="cmd-hist-menu">
                <button
                  v-for="(cmd, i) in cmdHistory"
                  :key="`${i}-${cmd}`"
                  type="button"
                  class="cmd-hist-item"
                  :title="cmd"
                  @click="copyCommand(cmd)"
                >
                  {{ cmd }}
                </button>
                <div v-if="!cmdHistory.length" class="cmd-hist-empty">
                  暂无命令历史
                </div>
              </div>
            </div>
          </div>

          <div class="panes">
            <template v-for="tab in sessions.tabs" :key="tab.sessionId">
              <TerminalPanel
                v-show="
                  tab.sessionId === sessions.activeSessionId &&
                  sessions.panel === 'terminal'
                "
                class="pane"
                :tab="tab"
                :active="
                  tab.sessionId === sessions.activeSessionId &&
                  sessions.panel === 'terminal'
                "
              />
              <div
                v-show="
                  tab.sessionId === sessions.activeSessionId &&
                  sessions.panel === 'sftp'
                "
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
                v-show="
                  tab.sessionId === sessions.activeSessionId &&
                  sessions.panel === 'metrics'
                "
                class="pane"
              >
                <MetricsView
                  v-if="tab.sessionId === sessions.activeSessionId"
                  :session-id="tab.sessionId"
                  :host-id="tab.hostId"
                  :active="
                    tab.sessionId === sessions.activeSessionId &&
                    sessions.panel === 'metrics'
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

.empty-logo {
  width: 64px;
  height: 64px;
  margin-bottom: 16px;
  border-radius: 18px;
  box-shadow: 0 12px 30px rgba(80, 150, 230, 0.3);
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

.cmd-hist-wrap {
  position: relative;
  flex-shrink: 0;
}

.cmd-hist-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 240px;
  max-width: min(480px, 70vw);
  max-height: 320px;
  overflow: auto;
  padding: 8px;
  border-radius: 12px;
  border: 1px solid var(--glass-border);
  background: color-mix(in srgb, #0b1522 92%, transparent);
  backdrop-filter: blur(16px);
  box-shadow: var(--glass-shadow);
}

.cmd-hist-item {
  display: block;
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
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.cmd-hist-item:hover {
  background: var(--accent-soft);
  color: var(--accent-hover);
}

.cmd-hist-empty {
  padding: 12px 10px;
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
}
</style>
