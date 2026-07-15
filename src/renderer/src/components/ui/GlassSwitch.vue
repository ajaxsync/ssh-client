<script setup lang="ts">
defineProps<{
  modelValue: boolean
  label: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()
</script>

<template>
  <div class="switch-row">
    <span class="switch-label">{{ label }}</span>
    <button
      type="button"
      class="track"
      :class="{ on: modelValue }"
      role="switch"
      :aria-checked="modelValue"
      :aria-label="label"
      @click="emit('update:modelValue', !modelValue)"
    >
      <span class="thumb" />
    </button>
  </div>
</template>

<style scoped>
.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  background: var(--glass-bg-input);
  padding: 10px 12px;
  color: var(--text-muted);
  font-size: 13px;
}

.switch-label {
  min-width: 0;
  user-select: none;
}

.track {
  width: 44px;
  height: 26px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid var(--glass-border);
  position: relative;
  transition: background 160ms var(--ease);
  flex-shrink: 0;
  padding: 0;
  cursor: pointer;
}

.track.on {
  background: color-mix(in srgb, var(--accent) 55%, transparent);
  border-color: color-mix(in srgb, var(--accent) 50%, white 20%);
}

.thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  transition: transform 160ms var(--ease);
  pointer-events: none;
}

.track.on .thumb {
  transform: translateX(18px);
}
</style>
