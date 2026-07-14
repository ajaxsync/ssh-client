<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAppStore } from '../stores/app'
import { useSessionStore } from '../stores/session'
import { useToastStore } from '../stores/toast'
import GlassTip from './ui/GlassTip.vue'

const emit = defineEmits<{
  close: []
}>()

const app = useAppStore()
const sessions = useSessionStore()
const toast = useToastStore()
const title = ref('')
const command = ref('')
const category = ref('')
const filter = ref('')

const filtered = computed(() => {
  const q = filter.value.trim().toLowerCase()
  if (!q) return app.snippets
  return app.snippets.filter(
    (s) =>
      s.title.toLowerCase().includes(q) ||
      s.command.toLowerCase().includes(q) ||
      (s.category || '').toLowerCase().includes(q)
  )
})

async function save(): Promise<void> {
  if (!title.value.trim() || !command.value.trim()) {
    toast.error('请填写标题和命令')
    return
  }
  await app.saveSnippet({
    id: crypto.randomUUID(),
    title: title.value.trim(),
    command: command.value,
    category: category.value.trim() || undefined
  })
  title.value = ''
  command.value = ''
  category.value = ''
}

function insert(cmd: string): void {
  sessions.insertSnippet(cmd)
  emit('close')
}

async function remove(id: string): Promise<void> {
  await app.deleteSnippet(id)
}
</script>

<template>
  <Teleport to="body">
    <div class="mask" @click.self="emit('close')">
      <aside class="drawer glass-panel">
        <div class="inner">
          <header>
            <h3>命令片段</h3>
            <GlassTip text="关闭" mode="wrap">
              <button class="btn-icon" type="button" @click="emit('close')">×</button>
            </GlassTip>
          </header>

          <input v-model="filter" class="glass-field" placeholder="搜索片段…" />

          <div class="list">
            <div v-for="item in filtered" :key="item.id" class="item hover-reveal-host">
              <div class="top">
                <strong>{{ item.title }}</strong>
                <span v-if="item.category" class="cat">{{ item.category }}</span>
              </div>
              <pre>{{ item.command }}</pre>
              <div class="ops hover-reveal">
                <button class="btn-accent sm" @click="insert(item.command)">插入</button>
                <button class="btn-glass sm danger" @click="remove(item.id)">删除</button>
              </div>
            </div>
            <div v-if="!filtered.length" class="empty">暂无片段</div>
          </div>

          <div class="composer">
            <input v-model="title" class="glass-field" placeholder="标题" />
            <input v-model="category" class="glass-field" placeholder="分类（可选）" />
            <textarea v-model="command" class="glass-field" rows="3" placeholder="命令内容" />
            <button class="btn-accent" @click="save">保存片段</button>
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
  animation: slide 280ms var(--ease);
}

@keyframes slide {
  from {
    transform: translateX(24px);
    opacity: 0;
  }
  to {
    transform: none;
    opacity: 1;
  }
}

.inner {
  position: relative;
  z-index: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  min-height: 0;
}

header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

h3 {
  margin: 0;
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
  padding: 10px;
  border-radius: 14px;
  border: 1px solid var(--glass-border);
  background: rgba(255, 255, 255, 0.04);
}

.top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.cat {
  font-size: 11px;
  color: var(--accent-hover);
}

pre {
  margin: 8px 0;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--text-muted);
}

.ops {
  display: flex;
  gap: 6px;
}

.composer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--glass-border);
}

textarea.glass-field {
  resize: vertical;
}

.empty,
.error {
  font-size: 13px;
  color: var(--text-muted);
}

.error {
  color: var(--danger);
  margin: 0;
}
</style>
