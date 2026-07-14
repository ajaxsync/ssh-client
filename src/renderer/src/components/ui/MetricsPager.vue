<script setup lang="ts">
defineProps<{
  page: number
  pageCount: number
}>()

const emit = defineEmits<{
  prev: []
  next: []
}>()
</script>

<template>
  <div class="pager">
    <button
      type="button"
      class="page-btn"
      title="上一页"
      aria-label="上一页"
      :disabled="page <= 1"
      @click="emit('prev')"
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M15 6 9 12l6 6"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>
    <span>{{ page }} / {{ pageCount }}</span>
    <button
      type="button"
      class="page-btn"
      title="下一页"
      aria-label="下一页"
      :disabled="page >= pageCount"
      @click="emit('next')"
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="m9 6 6 6-6 6"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.pager {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-muted);
}

.page-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--glass-border);
  border-radius: 9px;
  background: var(--glass-bg);
  color: var(--text-muted);
}

.page-btn svg {
  width: 14px;
  height: 14px;
  display: block;
}

.page-btn:hover:not(:disabled) {
  color: var(--text);
  background: var(--glass-bg-strong);
  border-color: var(--glass-border-strong);
}

.page-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
</style>
