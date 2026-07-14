<script setup lang="ts">
const props = defineProps<{
  modelValue: number
  min?: number
  max?: number
  step?: number
}>()

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

function bump(delta: number): void {
  const step = props.step || 1
  let next = Number(props.modelValue || 0) + delta * step
  if (props.min !== undefined) next = Math.max(props.min, next)
  if (props.max !== undefined) next = Math.min(props.max, next)
  emit('update:modelValue', next)
}

function onInput(e: Event): void {
  let next = Number((e.target as HTMLInputElement).value)
  if (Number.isNaN(next)) next = props.min ?? 0
  if (props.min !== undefined) next = Math.max(props.min, next)
  if (props.max !== undefined) next = Math.min(props.max, next)
  emit('update:modelValue', next)
}
</script>

<template>
  <div class="num">
    <input
      class="glass-field"
      type="number"
      :value="modelValue"
      :min="min"
      :max="max"
      :step="step || 1"
      @input="onInput"
    />
    <div class="spinners">
      <button type="button" class="spin" tabindex="-1" @click="bump(1)">▴</button>
      <button type="button" class="spin" tabindex="-1" @click="bump(-1)">▾</button>
    </div>
  </div>
</template>

<style scoped>
.num {
  position: relative;
  display: flex;
  align-items: stretch;
}

.num input {
  width: 100%;
  padding-right: 42px;
}

.spinners {
  position: absolute;
  top: 4px;
  right: 4px;
  bottom: 4px;
  width: 30px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.spin {
  flex: 1;
  border: 1px solid var(--glass-border);
  border-radius: 8px;
  background: var(--glass-bg);
  color: var(--text-muted);
  font-size: 10px;
  line-height: 1;
  padding: 0;
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.08) inset;
}

.spin:hover {
  color: var(--text);
  background: var(--glass-bg-strong);
  border-color: var(--glass-border-strong);
}
</style>
