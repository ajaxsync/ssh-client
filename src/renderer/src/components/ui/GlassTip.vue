<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    text: string
    /** badge：问号触发；wrap：悬浮在插槽内容上触发 */
    mode?: 'badge' | 'wrap'
  }>(),
  { mode: 'badge' }
)

const root = ref<HTMLElement | null>(null)
const visible = ref(false)
const placement = ref<'below' | 'above'>('below')
const pos = ref({ top: 0, left: 0 })
const bubbleWidth = ref(260)

const isWrap = computed(() => props.mode === 'wrap')

function place(): void {
  const el = root.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const maxW = Math.min(280, window.innerWidth - 24)
  const estimated = Math.min(maxW, Math.max(120, props.text.length * 7 + 24))
  bubbleWidth.value = estimated
  const left = Math.min(
    Math.max(12, r.left + r.width / 2 - estimated / 2),
    window.innerWidth - estimated - 12
  )
  const below = r.bottom + 10
  const preferBelow = below + 100 < window.innerHeight
  placement.value = preferBelow ? 'below' : 'above'
  pos.value = {
    top: preferBelow ? below : r.top - 10,
    left
  }
}

function hide(): void {
  visible.value = false
  window.removeEventListener('scroll', onScroll, true)
}

function onScroll(): void {
  if (visible.value) hide()
}

function onEnter(): void {
  if (!props.text) return
  place()
  visible.value = true
  window.addEventListener('scroll', onScroll, true)
}

function onLeave(): void {
  hide()
}

onUnmounted(() => {
  window.removeEventListener('scroll', onScroll, true)
})
</script>

<template>
  <span
    ref="root"
    class="glass-tip"
    :class="{ wrap: isWrap }"
    :tabindex="isWrap ? undefined : 0"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
    @focus="!isWrap && onEnter()"
    @blur="!isWrap && onLeave()"
  >
    <slot v-if="isWrap" />
    <template v-else>?</template>
    <Teleport to="body">
      <Transition name="tip-fade">
        <div
          v-if="visible"
          class="glass-tip-bubble"
          :class="placement"
          :style="{ top: `${pos.top}px`, left: `${pos.left}px`, width: `${bubbleWidth}px` }"
          role="tooltip"
        >
          {{ props.text }}
        </div>
      </Transition>
    </Teleport>
  </span>
</template>

<style scoped>
.glass-tip {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  color: var(--text-muted);
  font-size: 10px;
  font-style: normal;
  font-weight: 600;
  line-height: 1;
  cursor: help;
  flex-shrink: 0;
  outline: none;
}

.glass-tip:not(.wrap):hover,
.glass-tip:not(.wrap):focus-visible {
  color: var(--accent-hover);
  border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  background: var(--accent-soft);
}

.glass-tip.wrap {
  width: auto;
  height: auto;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: inherit;
  font-size: inherit;
  font-weight: inherit;
  cursor: inherit;
  vertical-align: middle;
}
</style>

<style>
.glass-tip-bubble {
  position: fixed;
  z-index: 4000;
  max-width: min(280px, calc(100vw - 24px));
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--glass-border-strong, var(--glass-border));
  background: color-mix(in srgb, #0b1522 82%, rgba(100, 160, 230, 0.22));
  color: var(--text, #e8f1ff);
  font-size: 12px;
  line-height: 1.55;
  letter-spacing: 0.01em;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.08) inset,
    0 16px 40px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(18px);
  pointer-events: none;
  box-sizing: border-box;
}

.glass-tip-bubble.above {
  transform: translateY(-100%);
}

[data-theme='light'] .glass-tip-bubble {
  background: color-mix(in srgb, #f4f8ff 88%, rgba(90, 140, 220, 0.2));
  color: #1a2a3a;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.7) inset,
    0 14px 32px rgba(40, 70, 110, 0.18);
}

.tip-fade-enter-active,
.tip-fade-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
}

.tip-fade-enter-from.below,
.tip-fade-leave-to.below {
  opacity: 0;
  transform: translateY(4px);
}

.tip-fade-enter-from.above,
.tip-fade-leave-to.above {
  opacity: 0;
  transform: translateY(calc(-100% - 4px));
}
</style>
