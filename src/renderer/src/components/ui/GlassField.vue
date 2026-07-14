<script setup lang="ts">
defineProps<{
  label?: string
  hint?: string
}>()
</script>

<template>
  <label class="glass-label">
    <span v-if="label" class="text">{{ label }}</span>
    <slot />
    <span v-if="hint" class="hint">{{ hint }}</span>
  </label>
</template>

<style scoped>
.glass-label {
  display: flex;
  flex-direction: column;
  gap: 7px;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--text-muted);
  min-width: 0;
}

.hint {
  font-size: 11px;
  opacity: 0.8;
}
</style>
