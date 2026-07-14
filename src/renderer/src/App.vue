<script setup lang="ts">
import { onMounted, onUnmounted, watch, ref } from 'vue'
import { useAppStore } from './stores/app'
import { useSessionStore } from './stores/session'
import UnlockView from './components/UnlockView.vue'
import HostSidebar from './components/HostSidebar.vue'
import SessionWorkspace from './components/SessionWorkspace.vue'
import SettingsModal from './components/SettingsModal.vue'
import SnippetsDrawer from './components/SnippetsDrawer.vue'
import TrashDrawer from './components/TrashDrawer.vue'
import GlassToastHost from './components/ui/GlassToastHost.vue'

const app = useAppStore()
const sessions = useSessionStore()
const showSettings = ref(false)
const showTrash = ref(false)

let offClosed: (() => void) | undefined
let offError: (() => void) | undefined

onMounted(async () => {
  await app.refreshStatus()
  offClosed = window.api.session.onClosed(({ sessionId }) => {
    void sessions.handleClosed(sessionId)
  })
  offError = window.api.session.onError(({ sessionId, message }) =>
    sessions.markError(sessionId, message)
  )
})

onUnmounted(() => {
  offClosed?.()
  offError?.()
})

watch(
  () => app.vault.unlocked,
  (unlocked) => {
    if (!unlocked) sessions.clearAll()
  }
)

async function handleLock(): Promise<void> {
  for (const tab of [...sessions.tabs]) {
    await sessions.closeTab(tab.sessionId)
  }
  await app.lock()
}
</script>

<template>
  <UnlockView v-if="!app.vault.unlocked" />
  <div v-else class="frame">
    <div class="orb orb-a" />
    <div class="orb orb-b" />
    <div class="shell">
      <HostSidebar
        class="side"
        @open-settings="showSettings = true"
        @open-trash="showTrash = true"
        @lock="handleLock"
      />
      <SessionWorkspace class="main" />
    </div>
    <SettingsModal v-if="showSettings" @close="showSettings = false" />
    <TrashDrawer v-if="showTrash" @close="showTrash = false" />
    <SnippetsDrawer v-if="sessions.showSnippets" @close="sessions.showSnippets = false" />
  </div>
  <GlassToastHost />
</template>

<style scoped>
.frame {
  position: relative;
  height: 100%;
  padding: 14px;
  overflow: hidden;
}

.orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(40px);
  pointer-events: none;
  opacity: 0.55;
  animation: drift 14s var(--ease) infinite alternate;
}

.orb-a {
  width: 340px;
  height: 340px;
  left: -60px;
  top: -40px;
  background: radial-gradient(circle, rgba(90, 170, 255, 0.55), transparent 70%);
}

.orb-b {
  width: 280px;
  height: 280px;
  right: -40px;
  bottom: 10%;
  background: radial-gradient(circle, rgba(70, 200, 190, 0.4), transparent 70%);
  animation-delay: -4s;
}

@keyframes drift {
  from {
    transform: translate3d(0, 0, 0) scale(1);
  }
  to {
    transform: translate3d(18px, 24px, 0) scale(1.08);
  }
}

.shell {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 300px 1fr;
  gap: 12px;
  height: 100%;
}

.side,
.main {
  min-height: 0;
  min-width: 0;
}
</style>
