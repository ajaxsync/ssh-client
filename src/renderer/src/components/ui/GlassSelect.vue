<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

export interface GlassOption {
  label: string
  value: string | number
}

const props = defineProps<{
  modelValue: string | number
  options: GlassOption[]
  placeholder?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | number]
}>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)

const currentLabel = computed(() => {
  const hit = props.options.find((o) => String(o.value) === String(props.modelValue))
  return hit?.label ?? props.placeholder ?? '请选择'
})

function select(opt: GlassOption): void {
  emit('update:modelValue', opt.value)
  open.value = false
}

function onDoc(e: MouseEvent): void {
  if (!root.value?.contains(e.target as Node)) open.value = false
}

onMounted(() => document.addEventListener('mousedown', onDoc))
onUnmounted(() => document.removeEventListener('mousedown', onDoc))
</script>

<template>
  <div ref="root" class="glass-select" :class="{ open, disabled }">
    <button
      type="button"
      class="trigger glass-field"
      :disabled="disabled"
      @click="open = !open"
    >
      <span>{{ currentLabel }}</span>
      <span class="chev">▾</span>
    </button>
    <div v-if="open" class="menu glass-panel">
      <button
        v-for="opt in options"
        :key="String(opt.value)"
        type="button"
        class="option"
        :class="{ active: String(opt.value) === String(modelValue) }"
        @click="select(opt)"
      >
        {{ opt.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.glass-select {
  position: relative;
  min-width: 0;
}

.trigger {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  text-align: left;
  cursor: pointer;
}

.chev {
  opacity: 0.6;
  font-size: 12px;
}

.menu {
  position: absolute;
  z-index: 30;
  left: 0;
  right: 0;
  top: calc(100% + 6px);
  border-radius: 14px;
  padding: 6px;
  max-height: 220px;
  overflow: auto;
}

.menu :deep(.glass-panel::before),
.menu::before {
  border-radius: 14px;
}

.option {
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  color: var(--text);
  padding: 10px 12px;
  border-radius: 10px;
}

.option:hover,
.option.active {
  background: var(--accent-soft);
  color: var(--accent-hover);
}

.disabled {
  opacity: 0.55;
  pointer-events: none;
}
</style>
