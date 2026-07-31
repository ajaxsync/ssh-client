<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import type {
  DatabaseConnectionConfig,
  DatabaseDetectedService,
  DatabaseDriver
} from '../../../shared/types'
import { useAppStore } from '../stores/app'
import { useToastStore } from '../stores/toast'
import GlassField from './ui/GlassField.vue'
import GlassSelect from './ui/GlassSelect.vue'
import GlassSwitch from './ui/GlassSwitch.vue'

const props = defineProps<{
  sessionId: string
  hostId: string
  service: DatabaseDetectedService
  connection: DatabaseConnectionConfig | null
}>()

const emit = defineEmits<{
  close: []
  saved: [connectionId: string]
}>()

const app = useAppStore()
const toast = useToastStore()
const testing = ref(false)
const saving = ref(false)

const form = reactive({
  id: props.connection?.id || crypto.randomUUID(),
  name: props.connection?.name || props.service.label,
  driver: (props.connection?.driver || props.service.driver) as DatabaseDriver,
  dbHost: props.connection?.dbHost || props.service.host,
  dbPort: props.connection?.dbPort || props.service.port,
  username: props.connection?.username || '',
  password: props.connection?.password || '',
  database: props.connection?.database || '',
  ssl: !!props.connection?.ssl,
  readonly: !!props.connection?.readonly,
  note: props.connection?.note || '',
  createdAt: props.connection?.createdAt || Date.now()
})

const driverOptions = [
  { label: 'MySQL / MariaDB', value: 'mysql' },
  { label: 'PostgreSQL', value: 'postgres' }
]

const portHint = computed(() => (form.driver === 'postgres' ? '默认 5432' : '默认 3306'))
const databasePlaceholder = computed(() =>
  form.driver === 'postgres' ? 'postgres 或实际业务库名' : '可选，默认使用账号默认库'
)

function applyDriverDefault(): void {
  form.dbPort = form.driver === 'postgres' ? 5432 : 3306
}

function buildPayload(): DatabaseConnectionConfig | null {
  if (!form.name.trim() || !form.dbHost.trim() || !form.username.trim()) {
    toast.error('请填写名称、数据库地址和用户名')
    return null
  }
  return {
    id: form.id,
    hostId: props.hostId,
    name: form.name.trim(),
    driver: props.service.driver,
    dbHost: props.service.host,
    dbPort: props.service.port,
    username: form.username.trim(),
    password: form.password,
    database: form.database.trim() || undefined,
    ssl: form.ssl,
    readonly: form.readonly,
    note: form.note.trim() || undefined,
    createdAt: form.createdAt,
    updatedAt: Date.now()
  }
}

async function testConnection(): Promise<void> {
  const payload = buildPayload()
  if (!payload) return
  testing.value = true
  try {
    const res = await window.api.database.testConnection(props.sessionId, payload)
    if (!res.ok) {
      toast.error(res.error, 8000)
      return
    }
    toast.success('数据库连接成功')
  } finally {
    testing.value = false
  }
}

async function save(): Promise<void> {
  const payload = buildPayload()
  if (!payload) return
  saving.value = true
  try {
    const saved = await app.saveDatabaseConnection(payload)
    if (!saved) {
      toast.error(app.error || '保存失败')
      return
    }
    emit('saved', saved.id)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="mask" @click.self="emit('close')">
      <div class="modal glass-panel">
        <div class="inner">
          <header>
            <h3>{{ connection ? '更新登录凭据' : '填写登录凭据' }}</h3>
            <button class="btn-icon" title="关闭" type="button" @click="emit('close')">×</button>
          </header>

          <div class="body">
            <div class="grid">
              <GlassField label="显示名称">
                <input v-model="form.name" class="glass-field" placeholder="生产 MySQL" />
              </GlassField>
              <GlassField label="数据库类型">
                <GlassSelect
                  v-model="form.driver"
                  :options="driverOptions"
                  disabled
                  @update:model-value="applyDriverDefault"
                />
              </GlassField>
              <GlassField label="数据库地址">
                <input v-model="form.dbHost" class="glass-field" readonly />
              </GlassField>
              <GlassField label="端口" :hint="portHint">
                <input
                  v-model.number="form.dbPort"
                  class="glass-field"
                  type="number"
                  min="1"
                  max="65535"
                  readonly
                />
              </GlassField>
              <GlassField label="用户名">
                <input v-model="form.username" class="glass-field" />
              </GlassField>
              <GlassField label="默认数据库">
                <input v-model="form.database" class="glass-field" :placeholder="databasePlaceholder" />
              </GlassField>
              <GlassField class="full" label="密码">
                <input
                  v-model="form.password"
                  class="glass-field"
                  type="password"
                  :placeholder="connection?.password ? '留空则保留原密码' : ''"
                />
              </GlassField>
              <div class="full toggles">
                <GlassSwitch v-model="form.readonly" label="只读连接" />
                <GlassSwitch v-model="form.ssl" label="启用 SSL" />
              </div>
              <GlassField class="full" label="备注">
                <input v-model="form.note" class="glass-field" placeholder="可选" />
              </GlassField>
            </div>
          </div>

          <div class="btn-row">
            <button class="btn-glass" type="button" @click="emit('close')">取消</button>
            <button class="btn-glass" type="button" :disabled="testing || saving" @click="testConnection">
              {{ testing ? '测试中…' : '测试连接' }}
            </button>
            <button class="btn-accent" type="button" :disabled="saving || testing" @click="save">
              {{ saving ? '保存中…' : '保存凭据' }}
            </button>
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
  width: min(680px, 100%);
  max-height: min(820px, calc(100vh - 48px));
}

.inner {
  position: relative;
  z-index: 1;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
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
  padding: 4px 8px;
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.full {
  grid-column: 1 / -1;
}

.toggles {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

@media (max-width: 640px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>
