<script setup lang="ts">
import { useAppStore } from '../stores/app'
import GlassTip from './ui/GlassTip.vue'

const emit = defineEmits<{ close: [] }>()
const app = useAppStore()

async function restore(id: string): Promise<void> {
  await app.restoreHost(id)
}

async function purge(id: string): Promise<void> {
  if (!confirm('彻底删除后无法恢复，确定？')) return
  await app.purgeHost(id)
}

async function empty(): Promise<void> {
  if (!confirm('清空回收站？此操作不可恢复。')) return
  await app.emptyTrash()
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString()
}
</script>

<template>
  <Teleport to="body">
    <div class="mask" @click.self="emit('close')">
      <aside class="drawer glass-panel">
        <div class="inner">
          <header>
            <div>
              <h3>回收站</h3>
              <p class="desc">误删主机可在此还原，最多保留 50 条</p>
            </div>
            <GlassTip text="关闭" mode="wrap">
              <button class="btn-icon" type="button" @click="emit('close')">×</button>
            </GlassTip>
          </header>

          <div class="toolbar" v-if="app.trash.length">
            <button class="btn-glass danger sm" @click="empty">清空回收站</button>
          </div>

          <div class="list">
            <div v-for="item in app.trash" :key="item.host.id" class="item hover-reveal-host">
              <div class="top">
                <strong>{{ item.host.name }}</strong>
                <span class="time">{{ formatTime(item.deletedAt) }}</span>
              </div>
              <div class="meta">
                {{ item.host.username }}@{{ item.host.host }}:{{ item.host.port }}
              </div>
              <div class="ops hover-reveal">
                <button class="btn-accent sm" @click="restore(item.host.id)">还原</button>
                <button class="btn-glass sm danger" @click="purge(item.host.id)">彻底删除</button>
              </div>
            </div>
            <div v-if="!app.trash.length" class="empty">回收站是空的</div>
          </div>
        </div>
      </aside>
    </div>
  </Teleport>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  background: rgba(4, 10, 18, 0.35);
  backdrop-filter: blur(6px);
  z-index: 1000;
  display: flex;
  justify-content: flex-end;
}

.drawer {
  width: min(420px, 92vw);
  height: 100%;
  border-radius: 24px 0 0 24px;
  border-right: none;
}

.inner {
  position: relative;
  z-index: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  min-height: 0;
}

header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

h3 {
  margin: 0;
}

.desc {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-muted);
}

.toolbar {
  display: flex;
  justify-content: flex-end;
}

.list {
  flex: 1;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}

.item {
  padding: 12px;
  border-radius: 14px;
  border: 1px solid var(--glass-border);
  background: rgba(255, 255, 255, 0.04);
}

.top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.time {
  font-size: 11px;
  color: var(--text-muted);
}

.meta {
  margin: 6px 0 10px;
  font-size: 12px;
  color: var(--text-muted);
  font-family: var(--mono);
}

.ops {
  display: flex;
  gap: 6px;
}

.empty {
  padding: 24px 8px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}
</style>
