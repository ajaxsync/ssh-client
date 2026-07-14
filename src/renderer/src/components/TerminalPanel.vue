<script setup lang="ts">
import type { TabSession } from '../stores/session'
import TerminalView from './TerminalView.vue'

defineProps<{
  tab: TabSession
  active: boolean
}>()
</script>

<template>
  <div class="terminal-panel">
    <div v-if="tab.error || tab.reconnecting || tab.closed" class="pane-toasts">
      <div v-if="tab.error" class="pane-toast error">{{ tab.error }}</div>
      <div v-if="tab.reconnecting" class="pane-toast warn">正在自动重连…</div>
      <div v-else-if="tab.closed" class="pane-toast warn">连接已断开，可关闭标签后重新连接</div>
    </div>

    <div v-if="!tab.closed || tab.reconnecting" class="terminal-body">
      <TerminalView :key="tab.sessionId" :session-id="tab.sessionId" :active="active" />
    </div>
  </div>
</template>

<style scoped>
.terminal-panel {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.terminal-body {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.terminal-body :deep(.wrap) {
  flex: 1;
  min-height: 0;
  min-width: 0;
}

.pane-toasts {
  position: absolute;
  left: 12px;
  right: 12px;
  top: 12px;
  z-index: 8;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}

.pane-toast {
  pointer-events: none;
  padding: 10px 12px;
  border-radius: 14px;
  border: 1px solid var(--glass-border);
  background: color-mix(in srgb, var(--glass-bg-strong) 88%, #041018);
  backdrop-filter: blur(16px);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
  font-size: 12px;
  line-height: 1.45;
}

.pane-toast.error {
  border-color: rgba(255, 123, 138, 0.4);
  background: color-mix(in srgb, rgba(80, 18, 28, 0.92) 70%, var(--glass-bg-strong));
  color: #ffc9d0;
}

.pane-toast.warn {
  border-color: rgba(251, 191, 36, 0.35);
  color: #fbbf24;
}
</style>
