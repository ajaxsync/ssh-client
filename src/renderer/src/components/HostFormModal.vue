<script setup lang="ts">
import { computed, reactive } from 'vue'
import type { HostConfig, TabColor } from '../../../shared/types'
import { TAB_COLORS } from '../../../shared/types'
import { useAppStore } from '../stores/app'
import { useToastStore } from '../stores/toast'
import GlassField from './ui/GlassField.vue'
import GlassSelect from './ui/GlassSelect.vue'
import GlassTip from './ui/GlassTip.vue'

const props = defineProps<{
  host: HostConfig | null
}>()

const emit = defineEmits<{
  close: []
  saved: []
}>()

const app = useAppStore()
const toast = useToastStore()

const form = reactive({
  id: props.host?.id || crypto.randomUUID(),
  name: props.host?.name || '',
  host: props.host?.host || '',
  port: props.host?.port || 22,
  username: props.host?.username || '',
  authType: props.host?.authType || ('password' as HostConfig['authType']),
  password: props.host?.password || '',
  privateKeyPath: props.host?.privateKeyPath || '',
  passphrase: props.host?.passphrase || '',
  group: props.host?.group || '',
  note: props.host?.note || '',
  color: (props.host?.color || 'default') as TabColor,
  jumpHostId: props.host?.jumpHostId || '',
  keepaliveInterval:
    props.host?.keepaliveInterval === undefined ? '' : String(props.host.keepaliveInterval)
})

const authOptions = [
  { label: '密码', value: 'password' },
  { label: '私钥', value: 'privateKey' }
]

const colorOptions = TAB_COLORS.map((c) => ({ label: c.label, value: c.id }))

const jumpOptions = computed(() => [
  { label: '无', value: '' },
  ...app.hosts
    .filter((x) => x.id !== form.id)
    .map((h) => ({ label: `${h.name} (${h.host})`, value: h.id }))
])

async function pickKey(): Promise<void> {
  const res = await window.api.dialog.openFile([
    { name: 'Private Key', extensions: ['*', 'pem', 'key', 'ppk'] }
  ])
  if (res.ok && res.data) form.privateKeyPath = res.data
}

async function save(): Promise<void> {
  if (!form.name.trim() || !form.host.trim() || !form.username.trim()) {
    toast.error('请填写名称、主机和用户名')
    return
  }
  if (form.authType === 'password' && !form.password) {
    toast.error('请填写登录密码')
    return
  }
  if (form.authType === 'privateKey' && !form.privateKeyPath) {
    toast.error('请选择私钥文件')
    return
  }
  if (form.jumpHostId && form.jumpHostId === form.id) {
    toast.error('跳板机不能是自己')
    return
  }

  const payload: HostConfig = {
    id: form.id,
    name: form.name.trim(),
    host: form.host.trim(),
    port: Number(form.port) || 22,
    username: form.username.trim(),
    authType: form.authType,
    group: form.group.trim() || undefined,
    note: form.note.trim() || undefined,
    color: form.color,
    jumpHostId: form.jumpHostId || undefined,
    keepaliveInterval:
      form.keepaliveInterval === '' ? undefined : Number(form.keepaliveInterval) || 0,
    lastConnectedAt: props.host?.lastConnectedAt
  }
  if (form.authType === 'password') payload.password = form.password
  else {
    payload.privateKeyPath = form.privateKeyPath
    payload.passphrase = form.passphrase || undefined
  }

  const ok = await app.saveHost(payload)
  if (!ok) {
    toast.error(app.error || '保存失败')
    return
  }
  emit('saved')
}
</script>

<template>
  <Teleport to="body">
    <div class="mask" @click.self="emit('close')">
      <div class="modal glass-panel">
        <div class="inner">
          <header>
            <h3>{{ host ? '编辑主机' : '添加主机' }}</h3>
            <GlassTip text="关闭" mode="wrap">
              <button class="btn-icon" type="button" @click="emit('close')">×</button>
            </GlassTip>
          </header>

          <div class="body">
            <div class="grid">
              <GlassField label="显示名称">
                <input v-model="form.name" class="glass-field" />
              </GlassField>
              <GlassField label="分组">
                <input v-model="form.group" class="glass-field" placeholder="可选" />
              </GlassField>
              <GlassField label="主机 / IP">
                <input v-model="form.host" class="glass-field" />
              </GlassField>
              <GlassField label="端口">
                <input
                  v-model.number="form.port"
                  class="glass-field"
                  type="number"
                  min="1"
                  max="65535"
                />
              </GlassField>
              <GlassField label="用户名">
                <input v-model="form.username" class="glass-field" />
              </GlassField>
              <GlassField label="认证方式">
                <GlassSelect v-model="form.authType" :options="authOptions" />
              </GlassField>

              <GlassField v-if="form.authType === 'password'" class="full" label="密码">
                <input v-model="form.password" class="glass-field" type="password" />
              </GlassField>
              <template v-else>
                <div class="full">
                  <GlassField label="私钥路径">
                    <div class="row">
                      <input v-model="form.privateKeyPath" class="glass-field" readonly />
                      <button class="btn-glass sm" type="button" @click="pickKey">选择</button>
                    </div>
                  </GlassField>
                </div>
                <GlassField class="full" label="私钥口令（可选）">
                  <input v-model="form.passphrase" class="glass-field" type="password" />
                </GlassField>
              </template>

              <GlassField class="full" label="跳板机 (ProxyJump)">
                <GlassSelect v-model="form.jumpHostId" :options="jumpOptions" />
              </GlassField>

              <GlassField label="标签颜色">
                <GlassSelect v-model="form.color" :options="colorOptions" />
              </GlassField>
              <GlassField label="Keepalive(ms)" hint="留空则跟随全局设置">
                <input
                  v-model="form.keepaliveInterval"
                  class="glass-field"
                  placeholder="空=跟随全局"
                />
              </GlassField>
              <GlassField class="full" label="备注">
                <input v-model="form.note" class="glass-field" placeholder="会话备注，便于辨认" />
              </GlassField>
            </div>
          </div>

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
  width: min(640px, 100%);
  max-height: min(860px, calc(100vh - 48px));
  display: flex;
  flex-direction: column;
}

.inner {
  position: relative;
  z-index: 1;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: min(860px, calc(100vh - 48px));
}

header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

h3 {
  margin: 0;
  font-size: 20px;
}

.body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  margin: 14px 0;
  /* 预留 focus 外扩阴影空间，避免被 overflow 裁切 */
  padding: 4px 8px 4px 8px;
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.full {
  grid-column: 1 / -1;
}

.grid :deep(.full) {
  grid-column: 1 / -1;
}

.row {
  display: flex;
  gap: 8px;
  min-width: 0;
}

.row input {
  flex: 1;
  min-width: 0;
}

.error {
  color: var(--danger);
  font-size: 13px;
  margin: 12px 0 0;
}

@media (max-width: 640px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>
