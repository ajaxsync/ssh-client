<script setup lang="ts">
defineProps<{
  text: string
  type?: 'error' | 'info' | 'success'
  closable?: boolean
}>()

defineEmits<{
  close: []
}>()
</script>

<template>
  <div class="glass-status-toast" :class="type || 'info'" role="status">
    <p>{{ text }}</p>
    <button
      v-if="closable"
      type="button"
      class="glass-status-close"
      aria-label="关闭"
      @click="$emit('close')"
    >
      ×
    </button>
  </div>
</template>

<style scoped>
.glass-status-toast {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 14px;
  border: 1px solid var(--glass-border);
  background: color-mix(in srgb, var(--glass-bg-strong) 88%, #041018);
  backdrop-filter: blur(16px);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
}

.glass-status-toast p {
  margin: 0;
  flex: 1;
  min-width: 0;
  font-size: 12px;
  line-height: 1.45;
  word-break: break-word;
  color: var(--text);
}

.glass-status-toast.info {
  border-color: color-mix(in srgb, var(--accent) 35%, transparent);
}

.glass-status-toast.success {
  border-color: color-mix(in srgb, var(--success) 40%, transparent);
}

.glass-status-toast.error {
  border-color: rgba(255, 123, 138, 0.4);
  background: color-mix(in srgb, rgba(80, 18, 28, 0.92) 70%, var(--glass-bg-strong));
}

.glass-status-toast.error p {
  color: #ffc9d0;
}

.glass-status-close {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  opacity: 0.7;
  font-size: 16px;
  line-height: 1;
}

.glass-status-close:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.08);
}
</style>
