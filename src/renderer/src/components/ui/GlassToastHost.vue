<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useToastStore } from '../../stores/toast'

const toast = useToastStore()
const { items } = storeToRefs(toast)
</script>

<template>
  <Teleport to="body">
    <div class="glass-toast-host" aria-live="polite">
      <TransitionGroup name="glass-toast">
        <div
          v-for="item in items"
          :key="item.id"
          class="glass-toast"
          :class="item.type"
          role="alert"
        >
          <p>{{ item.text }}</p>
          <button type="button" class="glass-toast-close" aria-label="关闭" @click="toast.dismiss(item.id)">
            ×
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style>
.glass-toast-host {
  position: fixed;
  left: 50%;
  bottom: 24px;
  z-index: 5000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(420px, calc(100vw - 32px));
  transform: translateX(-50%);
  pointer-events: none;
}

.glass-toast {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 14px;
  border: 1px solid var(--glass-border);
  background: color-mix(in srgb, var(--glass-bg-strong, #0b1522) 88%, #041018);
  backdrop-filter: blur(16px);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
}

.glass-toast p {
  margin: 0;
  flex: 1;
  min-width: 0;
  font-size: 12px;
  line-height: 1.35;
  word-break: break-word;
  color: var(--text, #e8f1ff);
}

.glass-toast.error {
  border-color: rgba(255, 123, 138, 0.4);
  background: color-mix(in srgb, rgba(80, 18, 28, 0.92) 70%, var(--glass-bg-strong, #0b1522));
}

.glass-toast.error p {
  color: #ffc9d0;
}

.glass-toast.info {
  border-color: color-mix(in srgb, var(--accent, #6eb6ff) 35%, transparent);
}

.glass-toast.success {
  border-color: color-mix(in srgb, var(--success, #5ddea6) 40%, transparent);
}

.glass-toast.success p {
  color: color-mix(in srgb, var(--success, #5ddea6) 85%, #fff);
}

.glass-toast-close {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  opacity: 0.7;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.glass-toast-close:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.08);
}

.glass-toast-enter-active,
.glass-toast-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.glass-toast-enter-from,
.glass-toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

.glass-toast-move {
  transition: transform 0.2s ease;
}
</style>
