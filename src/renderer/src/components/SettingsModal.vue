<script setup lang="ts">
import { reactive } from 'vue'
import { useAppStore } from '../stores/app'
import { DEFAULT_SETTINGS } from '../../../shared/types'
import GlassField from './ui/GlassField.vue'
import GlassSelect from './ui/GlassSelect.vue'
import GlassSwitch from './ui/GlassSwitch.vue'
import GlassNumberInput from './ui/GlassNumberInput.vue'

const emit = defineEmits<{ close: [] }>()
const app = useAppStore()

const form = reactive({
  fontSize: app.settings.fontSize,
  theme: app.settings.theme,
  keepaliveInterval: app.settings.keepaliveInterval ?? DEFAULT_SETTINGS.keepaliveInterval,
  autoReconnect: app.settings.autoReconnect ?? true,
  autoReconnectDelayMs:
    app.settings.autoReconnectDelayMs ?? DEFAULT_SETTINGS.autoReconnectDelayMs,
  autoReconnectMaxAttempts:
    app.settings.autoReconnectMaxAttempts ?? DEFAULT_SETTINGS.autoReconnectMaxAttempts
})

async function save(): Promise<void> {
  await app.saveSettings({
    ...app.settings,
    fontSize: Number(form.fontSize) || 14,
    theme: form.theme,
    keepaliveInterval: Number(form.keepaliveInterval) || 0,
    autoReconnect: form.autoReconnect,
    autoReconnectDelayMs: Number(form.autoReconnectDelayMs) || 2000,
    autoReconnectMaxAttempts: Number(form.autoReconnectMaxAttempts) || 5
  })
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div class="mask" @click.self="emit('close')">
      <div class="modal glass-panel">
        <div class="inner">
          <header>
            <h3>设置</h3>
            <button class="btn-icon" title="关闭" @click="emit('close')">×</button>
          </header>

          <GlassField label="终端字体大小">
            <GlassNumberInput v-model="form.fontSize" :min="10" :max="28" />
          </GlassField>

          <GlassField label="主题">
            <GlassSelect
              v-model="form.theme"
              :options="[
                { label: '深色玻璃', value: 'dark' },
                { label: '浅色玻璃', value: 'light' }
              ]"
            />
          </GlassField>

          <GlassField label="Keepalive 间隔（毫秒，0=关闭）">
            <GlassNumberInput v-model="form.keepaliveInterval" :min="0" :step="1000" />
          </GlassField>

          <GlassSwitch v-model="form.autoReconnect" label="断线自动重连" />

          <GlassField label="重连间隔（毫秒）">
            <GlassNumberInput v-model="form.autoReconnectDelayMs" :min="500" :step="500" />
          </GlassField>

          <GlassField label="最大重连次数">
            <GlassNumberInput v-model="form.autoReconnectMaxAttempts" :min="1" :max="20" />
          </GlassField>

          <div class="btn-row">
            <button class="btn-glass" @click="emit('close')">取消</button>
            <button class="btn-accent" @click="save">保存</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  background: rgba(4, 10, 18, 0.5);
  backdrop-filter: blur(12px);
  display: grid;
  place-items: center;
  z-index: 1000;
  padding: 24px;
}

.modal {
  width: min(440px, 100%);
}

.inner {
  position: relative;
  z-index: 1;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

h3 {
  margin: 0;
}
</style>
