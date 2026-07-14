<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { HostMetrics, MetricsCardId, MetricsLayoutItem } from '../../../shared/types'
import { DEFAULT_METRICS_LAYOUT, METRICS_LAYOUT_VERSION, resolveMetricsLayout } from '../../../shared/types'
import { useToastStore } from '../stores/toast'
import GlassSelect from './ui/GlassSelect.vue'
import GlassTip from './ui/GlassTip.vue'
import MetricsPager from './ui/MetricsPager.vue'

const props = defineProps<{
  sessionId: string
  active: boolean
  disabled?: boolean
}>()

const toast = useToastStore()
const metrics = ref<HostMetrics | null>(null)
const selectedIface = ref('全部')
const layout = ref<MetricsLayoutItem[]>(DEFAULT_METRICS_LAYOUT.map((x) => ({ ...x })))
const serviceFilter = ref<ServiceFilter>('all')
const procPage = ref(1)
const portsPage = ref(1)
const servicesPage = ref(1)
const disksPage = ref(1)
const HISTORY_LEN = 60

interface NetSample {
  t: number
  rx: number
  tx: number
}

const netHistory = ref<NetSample[]>([])
let offData: (() => void) | undefined
let started = false

const CARD_TITLE: Record<MetricsCardId, string> = {
  system: '系统信息',
  cpu: 'CPU',
  mem: '内存',
  gpu: 'GPU',
  disk: '磁盘',
  net: '网络',
  services: '服务',
  ports: '端口',
  proc: '进程'
}

const FIELD_HELP = {
  hostname: '服务器在网络中使用的名称，便于识别这台机器。',
  os: '操作系统发行版名称（来自 /etc/os-release），例如 Ubuntu、CentOS。',
  kernel: 'Linux 内核版本号。驱动、容器与部分性能特性都和内核相关。',
  arch: 'CPU 指令集架构，常见如 x86_64、aarch64（ARM）。软件包需与架构匹配。',
  primaryIp:
    '可访问该服务器的公网地址：优先使用主机配置里填写的连接 IP；若填的是域名，则探测一次远端出口公网 IP。',
  gateway: '默认路由网关，一般是本机出网方向的下一跳地址。',
  cpuCores: '逻辑 CPU 核数（含超线程）。对比负载时，负荷接近或超过核数通常表示较忙。',
  cpuModel: '处理器型号信息，来自 /proc/cpuinfo。',
  serverTime: '远端服务器当前本地时间与时区，约每 2 秒刷新。',
  uptime: '自上次开机以来持续运行的时长。约每 2 秒刷新，界面按天/时/分显示。',
  load: '系统平均负载（1 分钟 / 5 分钟 / 15 分钟）。大致表示排队等待的任务数；相对 CPU 核数偏高时，通常说明机器较忙。',
  cpu: '当前 CPU 总体使用率，由两次采样间隔计算得出。',
  mem: '已用内存占比。Swap 是内存不足时用到磁盘的交换空间。',
  gpu: '通过 nvidia-smi 采集的 NVIDIA GPU 利用率、显存与温度。无 NVIDIA 驱动时不显示此卡片。',
  disk: '各挂载点磁盘用量。占用过高可能影响写入与日志。',
  net: '网卡实时上下行速率波形与累计流量。可选全部或单块网卡。',
  services: '基于监听端口识别常见服务（网站、数据库、缓存等）。未监听不等于服务未安装。',
  ports: '当前 TCP 监听端口列表（地址与进程）。权限不足时进程名可能为空。',
  proc: '按 CPU 占用排序的进程列表，支持分页浏览（最多采集 500 条）。'
} as const

const SERVICE_CATEGORY_LABEL: Record<string, string> = {
  web: '网站',
  database: '数据库',
  cache: '缓存',
  message: '消息队列',
  other: '其他'
}

const PAGE_SIZE = 10
type ServiceFilter = 'all' | 'running' | 'stopped'
type PortFilter = 'all' | 'public' | 'local'
type ProcSort = 'cpu' | 'mem'

function cardKind(id: MetricsCardId): 'compact' | 'info' | 'chart' | 'list' {
  if (id === 'cpu' || id === 'mem' || id === 'gpu') return 'compact'
  if (id === 'system' || id === 'disk') return 'info'
  if (id === 'net') return 'chart'
  return 'list'
}

async function start(): Promise<void> {
  if (started || props.disabled) return
  started = true
  const res = await window.api.metrics.start(props.sessionId, 2000)
  if (!res.ok) {
    toast.error(res.error)
    started = false
  }
}

async function stop(): Promise<void> {
  if (!started) return
  started = false
  await window.api.metrics.stop(props.sessionId)
}

function formatBytes(n: number): string {
  const abs = Math.abs(n)
  if (abs < 1024) return `${n.toFixed(0)} B`
  if (abs < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (abs < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

/** Fixed-width-ish rate for UI (always one decimal + unit). */
function formatRate(n: number): string {
  const abs = Math.abs(n)
  if (abs < 1024) return `${n.toFixed(1)} B/s`
  if (abs < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB/s`
  if (abs < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB/s`
  return `${(n / 1024 ** 3).toFixed(2)} GB/s`
}

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d}天 ${h}时 ${m}分`
  if (h > 0) return `${h}时 ${m}分`
  return `${m} 分钟`
}

function pct(used: number, total: number): number {
  if (!total) return 0
  return Math.min(100, (used / total) * 100)
}

/** 占用着色统一阈值：≥85% 告警，否则正常 */
const USAGE_WARN_PCT = 85

function usageTone(percent: number): 'ok' | 'warn' {
  return percent >= USAGE_WARN_PCT ? 'warn' : 'ok'
}

function pushNetSample(payload: HostMetrics): void {
  const nets =
    selectedIface.value === '全部'
      ? payload.nets
      : payload.nets.filter((n) => n.name === selectedIface.value)
  const rx = nets.reduce((s, n) => s + n.rxRate, 0)
  const tx = nets.reduce((s, n) => s + n.txRate, 0)
  const next = [...netHistory.value, { t: payload.collectedAt, rx, tx }]
  if (next.length > HISTORY_LEN) next.splice(0, next.length - HISTORY_LEN)
  netHistory.value = next
}

const ifaceOptions = computed(() => {
  const names = metrics.value?.nets.map((n) => n.name) || []
  return ['全部', ...names].map((name) => ({ label: name, value: name }))
})

const liveRx = computed(() => netHistory.value.at(-1)?.rx ?? 0)
const liveTx = computed(() => netHistory.value.at(-1)?.tx ?? 0)

const runningServices = computed(
  () => metrics.value?.services.filter((s) => s.status === 'running') || []
)
const stoppedServices = computed(
  () => metrics.value?.services.filter((s) => s.status === 'stopped') || []
)

const filteredServices = computed(() => {
  const list = metrics.value?.services || []
  if (serviceFilter.value === 'running') return list.filter((s) => s.status === 'running')
  if (serviceFilter.value === 'stopped') return list.filter((s) => s.status === 'stopped')
  return list
})

const displayLayout = computed(() =>
  layout.value.filter((item) => item.id !== 'gpu')
)

/** 默认右侧堆叠：系统 | [CPU+内存 / 磁盘] */
const useStackedSide = computed(() => {
  const items = displayLayout.value
  if (items.length < 4) return false
  if (items[0]?.id !== 'system') return false
  if (items[1]?.id !== 'cpu' || items[1]?.stack !== 'side') return false
  if (items[2]?.id !== 'mem' || items[2]?.stack !== 'side') return false
  if (items[3]?.id !== 'disk' || items[3]?.stack !== 'side') return false
  return true
})

function cardGridStyle(item: MetricsLayoutItem): Record<string, string> | undefined {
  if (useStackedSide.value) return undefined
  const cols = item.cols
  const span = cols === 3 ? 2 : cols === 2 ? 3 : 6
  return { gridColumn: `span ${span}` }
}

function pageSlice<T>(list: T[], page: number): T[] {
  const start = (page - 1) * PAGE_SIZE
  return list.slice(start, start + PAGE_SIZE)
}

function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE))
}

const servicesPageCount = computed(() => pageCount(filteredServices.value.length))
const pagedServices = computed(() => pageSlice(filteredServices.value, servicesPage.value))

const portFilter = ref<PortFilter>('all')
const procSort = ref<ProcSort>('cpu')

function isLocalListenAddress(address: string): boolean {
  const raw = address.trim().toLowerCase()
  if (!raw) return false
  let host = raw
  const bracket = raw.match(/^\[([^\]]+)\](?::\d+)?$/)
  if (bracket) {
    host = bracket[1]
  } else {
    const ipv4 = raw.match(/^(\d+\.\d+\.\d+\.\d+)(?::\d+)?$/)
    if (ipv4) host = ipv4[1]
    else {
      const idx = raw.lastIndexOf(':')
      if (idx > 0) host = raw.slice(0, idx)
    }
  }
  return host === '127.0.0.1' || host === '::1' || host === 'localhost' || /^127\./.test(host)
}

const allPorts = computed(() => metrics.value?.listenPorts || [])
const portsTotal = computed(() => allPorts.value.length)
const portsTcpCount = computed(() => allPorts.value.filter((p) => p.protocol === 'tcp').length)
const portsLocalCount = computed(
  () => allPorts.value.filter((p) => isLocalListenAddress(p.address)).length
)
const portsPublicCount = computed(() => Math.max(0, portsTotal.value - portsLocalCount.value))
const portsNamedCount = computed(() => allPorts.value.filter((p) => !!p.process?.trim()).length)
const portsAnonCount = computed(() => Math.max(0, portsTotal.value - portsNamedCount.value))

const PORT_HINT_RULES: { label: string; ports: number[] }[] = [
  { label: 'SSH', ports: [22] },
  { label: 'Web', ports: [80, 443, 8080, 8000] },
  { label: '数据存储', ports: [3306, 5432, 27017, 6379] }
]

function hintForPort(port: number): string {
  return PORT_HINT_RULES.find((r) => r.ports.includes(port))?.label || ''
}

const filteredPorts = computed(() => {
  if (portFilter.value === 'public') {
    return allPorts.value.filter((p) => !isLocalListenAddress(p.address))
  }
  if (portFilter.value === 'local') {
    return allPorts.value.filter((p) => isLocalListenAddress(p.address))
  }
  return allPorts.value
})

const portsPageCount = computed(() => pageCount(filteredPorts.value.length))
const pagedPorts = computed(() => pageSlice(filteredPorts.value, portsPage.value))

function setPortFilter(next: PortFilter): void {
  portFilter.value = next
  portsPage.value = 1
}

const allProcesses = computed(() => metrics.value?.processes || [])
const procTotal = computed(() => allProcesses.value.length)

const sortedProcesses = computed(() => {
  const list = [...allProcesses.value]
  if (procSort.value === 'mem') {
    list.sort((a, b) => b.mem - a.mem || b.cpu - a.cpu)
  } else {
    list.sort((a, b) => b.cpu - a.cpu || b.mem - a.mem)
  }
  return list
})

const procPageCount = computed(() => pageCount(sortedProcesses.value.length))
const pagedProcesses = computed(() => pageSlice(sortedProcesses.value, procPage.value))

const topProcess = computed(() => sortedProcesses.value[0] || null)

const procUserStats = computed(() => {
  const map = new Map<string, number>()
  for (const p of allProcesses.value) {
    const u = p.user || '-'
    map.set(u, (map.get(u) || 0) + 1)
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
})

function setProcSort(next: ProcSort): void {
  if (procSort.value === next) return
  procSort.value = next
  procPage.value = 1
}

function shortenCommand(cmd: string, max = 18): string {
  const s = (cmd || '').trim()
  if (s.length <= max) return s
  return `${s.slice(0, max - 1)}…`
}

const disksTotal = computed(() => metrics.value?.disks.length || 0)
const disksPageCount = computed(() => pageCount(disksTotal.value))
const pagedDisks = computed(() => pageSlice(metrics.value?.disks || [], disksPage.value))

function setServiceFilter(next: ServiceFilter): void {
  serviceFilter.value = next
  servicesPage.value = 1
}

function clampPage(page: number, count: number): number {
  return Math.min(Math.max(1, page), count)
}

function shiftPage(
  which: 'proc' | 'ports' | 'services' | 'disks',
  delta: number
): void {
  if (which === 'proc') procPage.value = clampPage(procPage.value + delta, procPageCount.value)
  else if (which === 'ports') portsPage.value = clampPage(portsPage.value + delta, portsPageCount.value)
  else if (which === 'services')
    servicesPage.value = clampPage(servicesPage.value + delta, servicesPageCount.value)
  else disksPage.value = clampPage(disksPage.value + delta, disksPageCount.value)
}

const chart = computed(() => {
  const samples = netHistory.value
  const W = 600
  const H = 140
  const padX = 2
  const padY = 8
  const peak = Math.max(1, ...samples.flatMap((s) => [s.rx, s.tx]))
  const n = Math.max(samples.length - 1, 1)

  const toPoints = (key: 'rx' | 'tx'): string =>
    samples
      .map((s, i) => {
        const x = padX + (i / n) * (W - padX * 2)
        const y = H - padY - (s[key] / peak) * (H - padY * 2)
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')

  const toArea = (key: 'rx' | 'tx'): string => {
    if (!samples.length) return ''
    const line = toPoints(key)
    const firstX = padX
    const lastX = padX + ((samples.length - 1) / n) * (W - padX * 2)
    return `${firstX},${H - padY} ${line} ${lastX},${H - padY}`
  }

  const gridY = [0.25, 0.5, 0.75].map((r) => H - padY - r * (H - padY * 2))

  return {
    W,
    H,
    peak,
    gridY,
    rxLine: samples.length ? toPoints('rx') : '',
    txLine: samples.length ? toPoints('tx') : '',
    rxArea: toArea('rx'),
    txArea: toArea('tx')
  }
})

onMounted(() => {
  layout.value = resolveMetricsLayout(undefined, METRICS_LAYOUT_VERSION)
  offData = window.api.metrics.onData((payload) => {
    if (payload.sessionId !== props.sessionId) return
    metrics.value = payload
    if (payload.error) toast.error(payload.error)
    else pushNetSample(payload)
  })
  if (props.active && !props.disabled) void start()
})

watch(
  () => [props.active, props.disabled, props.sessionId] as const,
  async ([active, disabled], prev) => {
    if (prev && prev[2] !== props.sessionId) {
      netHistory.value = []
      selectedIface.value = '全部'
    }
    if (active && !disabled) await start()
    else await stop()
  }
)

watch(
  () => [
    metrics.value?.processes.length || 0,
    filteredPorts.value.length,
    metrics.value?.disks.length || 0,
    filteredServices.value.length
  ],
  () => {
    procPage.value = clampPage(procPage.value, procPageCount.value)
    portsPage.value = clampPage(portsPage.value, portsPageCount.value)
    disksPage.value = clampPage(disksPage.value, disksPageCount.value)
    servicesPage.value = clampPage(servicesPage.value, servicesPageCount.value)
  }
)

watch(selectedIface, () => {
  netHistory.value = []
})

onUnmounted(() => {
  offData?.()
  void stop()
})
</script>

<template>
  <div class="metrics" :class="{ disabled }">
    <div
      v-if="!metrics"
      class="layout-grid layout-stacked metrics-skeleton"
      aria-busy="true"
      aria-label="正在采集监控数据"
    >
      <section class="card sk-card" data-card="system">
        <div class="sk-line sk-title" />
        <div class="sk-grid">
          <div v-for="n in 8" :key="n" class="sk-field">
            <div class="sk-line sk-sm" />
            <div class="sk-line" />
          </div>
        </div>
      </section>
      <section class="card sk-card" data-card="cpu">
        <div class="sk-line sk-title" />
        <div class="sk-ring" />
      </section>
      <section class="card sk-card" data-card="mem">
        <div class="sk-line sk-title" />
        <div class="sk-ring" />
      </section>
      <section class="card sk-card" data-card="disk">
        <div class="sk-line sk-title" />
        <div v-for="n in 3" :key="n" class="sk-bar-row">
          <div class="sk-line sk-sm" />
          <div class="sk-bar" />
        </div>
      </section>
      <section class="card sk-card" data-card="net">
        <div class="sk-line sk-title" />
        <div class="sk-wave" />
        <div v-for="n in 2" :key="n" class="sk-line" />
      </section>
      <section class="card sk-card" data-card="services">
        <div class="sk-line sk-title" />
        <div class="sk-chips">
          <div v-for="n in 6" :key="n" class="sk-chip" />
        </div>
      </section>
      <section class="card sk-card" data-card="ports">
        <div class="sk-line sk-title" />
        <div v-for="n in 5" :key="n" class="sk-line" />
      </section>
      <section class="card sk-card" data-card="proc">
        <div class="sk-line sk-title" />
        <div v-for="n in 5" :key="n" class="sk-line" />
      </section>
    </div>

    <div v-if="metrics" class="layout-grid" :class="{ 'layout-stacked': useStackedSide }">
      <section
        v-for="item in displayLayout"
        :key="item.id"
        class="card"
        :data-card="item.id"
        :class="[`card-${cardKind(item.id)}`]"
        :style="cardGridStyle(item)"
      >
        <div class="card-top">
          <div class="card-title-row">
            <h4>{{ CARD_TITLE[item.id] }}</h4>
            <GlassTip
              v-if="item.id in FIELD_HELP"
              :text="FIELD_HELP[item.id as keyof typeof FIELD_HELP]"
            />
          </div>
          <div v-if="item.id === 'net'" class="card-actions net-tools">
            <label class="iface">
              <span>网卡</span>
              <GlassSelect v-model="selectedIface" :options="ifaceOptions" />
            </label>
            <div class="legend">
              <span class="lg rx"
                ><em>下行</em><b class="rate">{{ formatRate(liveRx) }}</b></span
              >
              <span class="lg tx"
                ><em>上行</em><b class="rate">{{ formatRate(liveTx) }}</b></span
              >
            </div>
          </div>
          <div
            v-else-if="item.id === 'services'"
            class="card-actions filter-pills"
            @pointerdown.stop
            @click.stop
          >
            <button
              type="button"
              class="btn-pill"
              :class="{ active: serviceFilter === 'all' }"
              @click="setServiceFilter('all')"
            >
              全部 {{ (metrics.services || []).length }}
            </button>
            <button
              type="button"
              class="btn-pill success"
              :class="{ active: serviceFilter === 'running' }"
              @click="setServiceFilter('running')"
            >
              运行中 {{ runningServices.length }}
            </button>
            <button
              type="button"
              class="btn-pill muted"
              :class="{ active: serviceFilter === 'stopped' }"
              @click="setServiceFilter('stopped')"
            >
              未检测到 {{ stoppedServices.length }}
            </button>
          </div>
          <div
            v-else-if="item.id === 'ports' && portsTotal"
            class="card-actions filter-pills"
            @pointerdown.stop
            @click.stop
          >
            <button
              type="button"
              class="btn-pill"
              :class="{ active: portFilter === 'all' }"
              @click="setPortFilter('all')"
            >
              全部 {{ portsTotal }}
            </button>
            <button
              type="button"
              class="btn-pill success"
              :class="{ active: portFilter === 'public' }"
              @click="setPortFilter('public')"
            >
              对外 {{ portsPublicCount }}
            </button>
            <button
              type="button"
              class="btn-pill"
              :class="{ active: portFilter === 'local' }"
              @click="setPortFilter('local')"
            >
              本机 {{ portsLocalCount }}
            </button>
          </div>
        </div>

        <div class="card-body">
        <template v-if="item.id === 'system'">
          <div class="grid info">
            <div>
              <span class="label">主机名 <GlassTip :text="FIELD_HELP.hostname" /></span>
              <strong>{{ metrics.hostname }}</strong>
            </div>
            <div>
              <span class="label">系统 <GlassTip :text="FIELD_HELP.os" /></span>
              <strong>{{ metrics.os }}</strong>
            </div>
            <div>
              <span class="label">公网 IP <GlassTip :text="FIELD_HELP.primaryIp" /></span>
              <strong>{{ metrics.primaryIp || '-' }}</strong>
            </div>
            <div>
              <span class="label">网关 <GlassTip :text="FIELD_HELP.gateway" /></span>
              <strong>{{ metrics.gateway || '-' }}</strong>
            </div>
            <div>
              <span class="label">内核 <GlassTip :text="FIELD_HELP.kernel" /></span>
              <strong>{{ metrics.kernel }}</strong>
            </div>
            <div>
              <span class="label">架构 <GlassTip :text="FIELD_HELP.arch" /></span>
              <strong>{{ metrics.arch }}</strong>
            </div>
            <div>
              <span class="label">CPU 核数 <GlassTip :text="FIELD_HELP.cpuCores" /></span>
              <strong>{{ metrics.cpuCores || '-' }}</strong>
            </div>
            <div>
              <span class="label">CPU 型号 <GlassTip :text="FIELD_HELP.cpuModel" /></span>
              <strong>{{ metrics.cpuModel || '-' }}</strong>
            </div>
            <div>
              <span class="label">运行时间 <GlassTip :text="FIELD_HELP.uptime" /></span>
              <strong>{{ formatUptime(metrics.uptimeSec) }}</strong>
            </div>
            <div>
              <span class="label">服务器时间 <GlassTip :text="FIELD_HELP.serverTime" /></span>
              <strong>{{ metrics.serverTime || '-' }}</strong>
            </div>
            <div class="full">
              <span class="label">负载 <GlassTip :text="FIELD_HELP.load" /></span>
              <strong
                >{{ metrics.load1.toFixed(2) }} / {{ metrics.load5.toFixed(2) }} /
                {{ metrics.load15.toFixed(2)
                }}<template v-if="metrics.cpuCores"
                  >（{{ metrics.cpuCores }} 核）</template
                ></strong
              >
            </div>
          </div>
        </template>

        <template v-else-if="item.id === 'cpu'">
          <div class="ring-metric">
            <div class="ring" :class="`usage-${usageTone(metrics.cpuPercent)}`">
              <svg viewBox="0 0 36 36" aria-hidden="true">
                <path
                  class="ring-track"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                <path
                  class="ring-fill"
                  :stroke-dasharray="`${Math.min(100, metrics.cpuPercent).toFixed(1)} 100`"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
              </svg>
              <div class="ring-center">
                <strong>{{ metrics.cpuPercent.toFixed(1) }}</strong>
                <span>%</span>
              </div>
            </div>
            <p v-if="metrics.cpuModel && metrics.cpuModel !== '-'" class="sub">
              {{ metrics.cpuModel
              }}<template v-if="metrics.cpuCores"> · {{ metrics.cpuCores }} 核</template>
            </p>
          </div>
        </template>

        <template v-else-if="item.id === 'mem'">
          <div class="ring-metric">
            <div
              class="ring"
              :class="`usage-${usageTone(pct(metrics.memUsed, metrics.memTotal))}`"
            >
              <svg viewBox="0 0 36 36" aria-hidden="true">
                <path
                  class="ring-track"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                <path
                  class="ring-fill"
                  :stroke-dasharray="`${pct(metrics.memUsed, metrics.memTotal).toFixed(1)} 100`"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
              </svg>
              <div class="ring-center">
                <strong>{{ pct(metrics.memUsed, metrics.memTotal).toFixed(1) }}</strong>
                <span>%</span>
              </div>
            </div>
            <p class="sub">
              {{ formatBytes(metrics.memUsed) }} / {{ formatBytes(metrics.memTotal) }} · Swap
              {{ formatBytes(metrics.swapUsed) }} / {{ formatBytes(metrics.swapTotal) }}
            </p>
          </div>
        </template>

        <template v-else-if="item.id === 'gpu'">
          <div v-if="!metrics.gpus?.length" class="hint">未检测到 NVIDIA GPU（需 nvidia-smi）</div>
          <div v-for="g in metrics.gpus || []" :key="g.index" class="gpu-card">
            <div class="gpu-top">
              <strong>GPU {{ g.index }} · {{ g.name }}</strong>
              <span>{{ g.tempC.toFixed(0) }}°C</span>
            </div>
            <div class="gpu-stats">
              <div>
                <span>利用率</span>
                <strong>{{ g.utilPercent.toFixed(0) }}%</strong>
                <div class="bar"><i :style="{ width: `${g.utilPercent}%` }" /></div>
              </div>
              <div>
                <span>显存</span>
                <strong
                  >{{ g.memUsedMiB.toFixed(0) }} / {{ g.memTotalMiB.toFixed(0) }} MiB</strong
                >
                <div class="bar">
                  <i
                    :style="{
                      width: `${pct(g.memUsedMiB, g.memTotalMiB)}%`
                    }"
                  />
                </div>
              </div>
            </div>
          </div>
        </template>

        <template v-else-if="item.id === 'disk'">
          <div v-if="!metrics.disks.length" class="hint">暂无数据</div>
          <template v-else>
            <div v-if="disksTotal > PAGE_SIZE" class="list-head">
              <span class="hint">共 {{ disksTotal }} 个挂载点</span>
              <MetricsPager
                :page="disksPage"
                :page-count="disksPageCount"
                @prev="shiftPage('disks', -1)"
                @next="shiftPage('disks', 1)"
              />
            </div>
            <div
              v-for="d in pagedDisks"
              :key="d.mount"
              class="disk"
              :class="`usage-${usageTone(d.usedPercent)}`"
            >
              <div class="disk-top">
                <strong>{{ d.mount }}</strong>
                <span
                  >{{ d.usedPercent.toFixed(0) }}% · {{ formatBytes(d.used) }} /
                  {{ formatBytes(d.size) }}</span
                >
              </div>
              <div class="bar"><i :style="{ width: `${d.usedPercent}%` }" /></div>
            </div>
          </template>
        </template>

        <template v-else-if="item.id === 'net'">
          <div class="wave-wrap">
            <div class="wave-meta">
              <span class="peak"
                >峰值 <b class="rate">{{ formatRate(chart.peak) }}</b></span
              >
              <span>近 {{ netHistory.length }} 次采样</span>
            </div>
            <svg
              class="wave"
              :viewBox="`0 0 ${chart.W} ${chart.H}`"
              preserveAspectRatio="none"
              aria-label="网络速率波形"
              :style="{
                '--rx-fill': `url(#rxFill-${sessionId})`,
                '--tx-fill': `url(#txFill-${sessionId})`
              }"
            >
              <defs>
                <linearGradient :id="`rxFill-${sessionId}`" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#5b9dff" stop-opacity="0.45" />
                  <stop offset="100%" stop-color="#5b9dff" stop-opacity="0.02" />
                </linearGradient>
                <linearGradient :id="`txFill-${sessionId}`" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#2dd4bf" stop-opacity="0.35" />
                  <stop offset="100%" stop-color="#2dd4bf" stop-opacity="0.02" />
                </linearGradient>
              </defs>
              <line
                v-for="y in chart.gridY"
                :key="y"
                class="grid-line"
                x1="0"
                :y1="y"
                :x2="chart.W"
                :y2="y"
              />
              <polygon v-if="chart.rxArea" class="area-rx" :points="chart.rxArea" />
              <polygon v-if="chart.txArea" class="area-tx" :points="chart.txArea" />
              <polyline v-if="chart.rxLine" class="line-rx" :points="chart.rxLine" />
              <polyline v-if="chart.txLine" class="line-tx" :points="chart.txLine" />
            </svg>
            <div v-if="netHistory.length < 2" class="wave-empty">采集中，波形即将出现…</div>
          </div>

          <div v-if="!metrics.nets.length" class="hint">暂无数据</div>
          <div v-else class="table-scroll">
            <div class="table net-table">
              <div class="thead">
                <span>网卡</span><span>下行</span><span>上行</span><span>累计 RX</span
                ><span>累计 TX</span>
              </div>
              <div v-for="n in metrics.nets" :key="n.name" class="trow">
                <span>{{ n.name }}</span>
                <span class="rate">{{ formatRate(n.rxRate) }}</span>
                <span class="rate">{{ formatRate(n.txRate) }}</span>
                <span class="rate">{{ formatBytes(n.rxBytes) }}</span>
                <span class="rate">{{ formatBytes(n.txBytes) }}</span>
              </div>
            </div>
          </div>
        </template>

        <template v-else-if="item.id === 'services'">
          <div v-if="filteredServices.length > PAGE_SIZE" class="list-head">
            <span class="hint">共 {{ filteredServices.length }} 项</span>
            <MetricsPager
              :page="servicesPage"
              :page-count="servicesPageCount"
              @prev="shiftPage('services', -1)"
              @next="shiftPage('services', 1)"
            />
          </div>

          <div class="svc-grid">
            <div
              v-for="s in pagedServices"
              :key="s.id"
              class="svc-item"
              :class="s.status"
            >
              <div class="svc-top">
                <strong>{{ s.name }}</strong>
                <span
                  class="svc-dot"
                  :class="s.status"
                  :title="s.status === 'running' ? '运行中' : '未监听'"
                  :aria-label="s.status === 'running' ? '运行中' : '未监听'"
                />
              </div>
              <div class="svc-meta">
                <span>{{ SERVICE_CATEGORY_LABEL[s.category] || s.category }}</span>
                <span>端口 {{ s.ports.join('/') }}</span>
                <span v-if="s.listenPort">当前 :{{ s.listenPort }}</span>
                <span v-if="s.process">{{ s.process }}</span>
              </div>
            </div>
          </div>
        </template>

        <template v-else-if="item.id === 'ports'">
          <div v-if="!portsTotal" class="hint">暂无监听端口数据（可能无 ss/权限）</div>
          <template v-else>
            <div class="list-head">
              <span class="hint list-head-meta">
                <span>TCP {{ portsTcpCount }}</span>
                <span>有名 {{ portsNamedCount }} · 匿名 {{ portsAnonCount }}</span>
              </span>
              <MetricsPager
                v-if="filteredPorts.length > PAGE_SIZE"
                :page="portsPage"
                :page-count="portsPageCount"
                @prev="shiftPage('ports', -1)"
                @next="shiftPage('ports', 1)"
              />
            </div>
            <div class="table-scroll">
              <div class="table port-table">
                <div class="thead">
                  <span>协议</span><span>端口</span><span>提示</span><span>地址</span><span>进程</span>
                </div>
                <div
                  v-for="p in pagedPorts"
                  :key="p.address + p.port + p.process"
                  class="trow"
                >
                  <span class="proto">{{ p.protocol }}</span>
                  <span class="port-num">{{ p.port }}</span>
                  <span class="port-hint-cell">
                    <span v-if="hintForPort(p.port)" class="port-hint-chip sm">{{
                      hintForPort(p.port)
                    }}</span>
                    <span v-else class="muted">-</span>
                  </span>
                  <span class="cmd">{{ p.address }}</span>
                  <span class="cmd">{{ p.process || '-' }}</span>
                </div>
              </div>
            </div>
          </template>
        </template>

        <template v-else-if="item.id === 'proc'">
          <div class="list-head">
            <span class="hint list-head-meta">
              <span>共 {{ procTotal }} · {{ procSort === 'cpu' ? '按 CPU' : '按内存' }}</span>
              <span
                v-if="topProcess"
                class="top-proc"
                :title="`${topProcess.command} CPU ${topProcess.cpu.toFixed(1)}% · MEM ${topProcess.mem.toFixed(1)}%`"
              >
                最高：{{ shortenCommand(topProcess.command) }}
                {{
                  procSort === 'cpu'
                    ? `${topProcess.cpu.toFixed(1)}%`
                    : `${topProcess.mem.toFixed(1)}%`
                }}
              </span>
              <span v-if="procUserStats.length" class="user-stats">
                <template v-for="(u, i) in procUserStats" :key="u[0]">
                  <template v-if="i"> · </template>{{ u[0] }} {{ u[1] }}
                </template>
              </span>
            </span>
            <MetricsPager
              v-if="procTotal > PAGE_SIZE"
              :page="procPage"
              :page-count="procPageCount"
              @prev="shiftPage('proc', -1)"
              @next="shiftPage('proc', 1)"
            />
          </div>
          <div class="table-scroll">
            <div class="table proc">
              <div class="thead">
                <span>PID</span>
                <span>用户</span>
                <button
                  type="button"
                  class="sort-col"
                  :class="{ active: procSort === 'cpu' }"
                  @click="setProcSort('cpu')"
                >
                  CPU%
                </button>
                <button
                  type="button"
                  class="sort-col"
                  :class="{ active: procSort === 'mem' }"
                  @click="setProcSort('mem')"
                >
                  MEM%
                </button>
                <span>命令</span>
              </div>
              <div v-for="p in pagedProcesses" :key="p.pid + p.command" class="trow">
                <span>{{ p.pid }}</span>
                <span class="cmd">{{ p.user }}</span>
                <span>{{ p.cpu.toFixed(1) }}</span>
                <span>{{ p.mem.toFixed(1) }}</span>
                <span class="cmd" :title="p.command">{{ p.command }}</span>
              </div>
            </div>
          </div>
        </template>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.metrics {
  height: 100%;
  overflow: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
}

.metrics.disabled {
  opacity: 0.55;
  pointer-events: none;
}

.layout-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 12px;
  align-items: stretch;
  width: 100%;
  min-width: 0;
}

/* 默认：左系统跨两行；右上 CPU|内存，右下磁盘；其后网络|服务、端口|进程 */
.layout-grid.layout-stacked {
  grid-template-columns: repeat(12, minmax(0, 1fr));
}

.layout-grid.layout-stacked > .card[data-card='system'] {
  grid-column: 1 / 7;
  grid-row: 1 / 3;
}

.layout-grid.layout-stacked > .card[data-card='cpu'] {
  grid-column: 7 / 10;
  grid-row: 1;
}

.layout-grid.layout-stacked > .card[data-card='mem'] {
  grid-column: 10 / 13;
  grid-row: 1;
}

.layout-grid.layout-stacked > .card[data-card='disk'] {
  grid-column: 7 / 13;
  grid-row: 2;
}

.layout-grid.layout-stacked > .card[data-card='net'] {
  grid-column: 1 / 7;
  grid-row: 3;
}

.layout-grid.layout-stacked > .card[data-card='services'] {
  grid-column: 7 / 13;
  grid-row: 3;
}

.layout-grid.layout-stacked > .card[data-card='ports'] {
  grid-column: 1 / 7;
  grid-row: 4;
}

.layout-grid.layout-stacked > .card[data-card='proc'] {
  grid-column: 7 / 13;
  grid-row: 4;
}

@media (max-width: 800px) {
  .layout-grid.layout-stacked > .card[data-card] {
    grid-column: 1 / -1 !important;
    grid-row: auto !important;
  }
}

.card {
  border: 1px solid var(--glass-border);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.04);
  padding: 14px;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.card-compact {
  min-height: 168px;
}

.card-info {
  min-height: 240px;
}

.card-chart {
  min-height: 280px;
}

.card-list {
  min-height: 320px;
}

.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px 12px;
  margin-bottom: 10px;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.card-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 6px;
  margin-left: auto;
  min-width: 0;
  max-width: 100%;
}

.card-body {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: auto;
}

.card-compact .card-body {
  justify-content: center;
}

.card-title-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

h4 {
  margin: 0;
  font-size: 13px;
  color: var(--text-muted);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.net-tools {
  gap: 8px 12px;
}

.iface {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
}

.iface :deep(.glass-select) {
  min-width: 120px;
}

.iface :deep(.trigger) {
  min-height: 30px;
  padding: 4px 10px;
  font-size: 12px;
  border-radius: 10px;
}

.legend {
  display: flex;
  gap: 12px;
  font-size: 12px;
  flex-shrink: 0;
}

.lg {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 118px;
}

.lg em {
  font-style: normal;
  color: var(--text-muted);
  flex-shrink: 0;
}

.lg::before {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.lg.rx::before {
  background: #5b9dff;
  box-shadow: 0 0 8px rgba(91, 157, 255, 0.6);
}

.lg.tx::before {
  background: #2dd4bf;
  box-shadow: 0 0 8px rgba(45, 212, 191, 0.55);
}

.rate {
  display: inline-block;
  min-width: 9.5ch;
  text-align: right;
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  white-space: nowrap;
}

.peak {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.peak .rate {
  min-width: 10ch;
}

.wave-wrap {
  position: relative;
  margin-bottom: 12px;
  border: 1px solid var(--glass-border);
  border-radius: 14px;
  background:
    linear-gradient(180deg, rgba(91, 157, 255, 0.05), transparent 40%),
    rgba(0, 0, 0, 0.16);
  overflow: hidden;
  flex: 1;
  min-height: 140px;
  display: flex;
  flex-direction: column;
}

.wave-meta {
  display: flex;
  justify-content: space-between;
  padding: 8px 10px 0;
  font-size: 11px;
  color: var(--text-muted);
}

.wave {
  display: block;
  width: 100%;
  flex: 1;
  min-height: 120px;
  height: 140px;
}

.grid-line {
  stroke: rgba(255, 255, 255, 0.08);
  stroke-width: 1;
}

.area-rx {
  fill: var(--rx-fill);
}

.area-tx {
  fill: var(--tx-fill);
}

.line-rx,
.line-tx {
  fill: none;
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.line-rx {
  stroke: #5b9dff;
}

.line-tx {
  stroke: #2dd4bf;
}

.wave-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 12px;
  color: var(--text-muted);
  pointer-events: none;
}

.grid.info {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 14px;
}

.grid.info .full {
  grid-column: 1 / -1;
}

.grid.info .label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 2px;
}

.grid.info strong {
  display: block;
  font-size: 13px;
  font-weight: 600;
  word-break: break-all;
}

.big {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.03em;
  margin-bottom: 8px;
}

.ring-metric {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  flex: 1;
  min-height: 0;
  text-align: center;
}

.ring {
  position: relative;
  width: min(112px, 100%);
  aspect-ratio: 1;
}

.ring svg {
  display: block;
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

.ring-track,
.ring-fill {
  fill: none;
  stroke-width: 2.8;
}

.ring-track {
  stroke: rgba(255, 255, 255, 0.08);
}

.ring-fill {
  stroke: var(--usage);
  stroke-linecap: round;
  transition:
    stroke-dasharray 0.35s ease,
    stroke 0.35s ease;
}

.usage-ok {
  --usage: #7dffa8;
}

.usage-warn {
  --usage: var(--danger);
}

.ring.usage-ok .ring-center strong,
.ring.usage-warn .ring-center strong {
  color: var(--usage);
  transition: color 0.35s ease;
}

.ring-center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0;
  pointer-events: none;
}

.ring-center strong {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.1;
}

.ring-center span {
  font-size: 11px;
  color: var(--text-muted);
}

.ring-metric .sub {
  margin: 0;
  max-width: 100%;
}

.bar {
  height: 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.bar i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #4a9ef0, var(--accent));
  transition:
    width 0.35s ease,
    background 0.35s ease;
}

.disk.usage-ok .bar i,
.disk.usage-warn .bar i {
  background: var(--usage);
}

.disk.usage-ok .disk-top span,
.disk.usage-warn .disk-top span {
  color: var(--usage);
  transition: color 0.35s ease;
}

.sub {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--text-muted);
}

.disk + .disk {
  margin-top: 10px;
}

.disk-top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  margin-bottom: 6px;
  color: var(--text-muted);
}

.disk-top strong {
  color: var(--text);
}

.table-scroll {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  overflow: auto;
  overscroll-behavior: contain;
  flex: 1;
  min-height: 0;
}

.table {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  min-width: 0;
  width: 100%;
}

.thead,
.trow {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) repeat(4, minmax(0, 1fr));
  gap: 8px;
  padding: 6px 4px;
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
}

.thead > span,
.trow > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.proc {
  min-width: 460px;
}

.proc .thead,
.proc .trow {
  grid-template-columns: 56px minmax(52px, 0.9fr) 52px 52px minmax(0, 1.6fr);
}

.port-table {
  min-width: 380px;
}

.port-table .thead,
.port-table .trow {
  grid-template-columns: 44px 56px minmax(64px, 0.7fr) minmax(0, 1.2fr) minmax(0, 1fr);
}

.port-table .proto {
  text-transform: uppercase;
  font-size: 11px;
  color: var(--text-muted);
}

.port-hint-cell {
  display: flex;
  align-items: center;
  min-width: 0;
}

.port-hint-cell .muted {
  color: var(--text-muted);
}

.net-table {
  min-width: 480px;
}

.net-table .thead,
.net-table .trow {
  grid-template-columns: minmax(64px, 1.1fr) repeat(4, minmax(72px, 1fr));
}

.thead {
  color: var(--text-muted);
  border-bottom: 1px solid var(--glass-border);
  position: sticky;
  top: 0;
  background: color-mix(in srgb, #0b1522 88%, transparent);
  z-index: 1;
}

.trow {
  border-radius: 8px;
}

.trow:hover {
  background: var(--accent-soft);
}

.cmd {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.svc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: 8px;
  margin-bottom: 0;
  flex: 1;
  min-height: 0;
  align-content: start;
  overflow: auto;
}

.svc-item {
  border: 1px solid var(--glass-border);
  border-radius: 12px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.03);
  min-width: 0;
}

.svc-item.running {
  border-color: rgba(125, 255, 168, 0.28);
  background: rgba(60, 180, 110, 0.08);
}

.svc-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.svc-top strong {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.svc-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(160, 170, 185, 0.55);
  box-shadow: 0 0 0 1px rgba(160, 170, 185, 0.25);
}

.svc-dot.running {
  background: #7dffa8;
  box-shadow: 0 0 0 1px rgba(125, 255, 168, 0.35), 0 0 8px rgba(125, 255, 168, 0.35);
}

.svc-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  font-size: 11px;
  color: var(--text-muted);
}

.sub-title {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 600;
}

.port-table .port-num {
  display: block;
  text-align: left;
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.list-head,
.proc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
  flex-shrink: 0;
}

.list-head-meta {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px 12px;
  min-width: 0;
}

.top-proc {
  color: var(--text);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: min(240px, 52vw);
}

.user-stats {
  color: var(--text-muted);
}

.sort-col {
  appearance: none;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  padding: 0;
  margin: 0;
  text-align: left;
  cursor: pointer;
}

.sort-col:hover {
  color: var(--text);
}

.sort-col.active {
  color: var(--accent-hover);
  font-weight: 700;
}

.card-actions.filter-pills .btn-pill {
  padding: 0 8px;
  min-height: 24px;
}

.port-hint-chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  color: #7dffa8;
  border: 1px solid rgba(125, 255, 168, 0.35);
  background: rgba(60, 180, 110, 0.12);
}

.port-hint-chip.sm {
  padding: 1px 6px;
  font-size: 10px;
}

.gpu-card + .gpu-card {
  margin-top: 12px;
}

.gpu-top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 13px;
}

.gpu-top span {
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.gpu-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.gpu-stats span {
  display: block;
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 2px;
}

.gpu-stats strong {
  display: block;
  font-size: 13px;
  margin-bottom: 6px;
}

.hint,
.error {
  font-size: 13px;
  color: var(--text-muted);
}

.error {
  color: var(--danger);
}

.metrics-skeleton {
  pointer-events: none;
}

.sk-card {
  gap: 10px;
}

.sk-card .sk-line,
.sk-card .sk-bar,
.sk-card .sk-ring,
.sk-card .sk-wave,
.sk-card .sk-chip {
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.06) 0%,
    rgba(255, 255, 255, 0.12) 45%,
    rgba(255, 255, 255, 0.06) 90%
  );
  background-size: 200% 100%;
  animation: sk-shimmer 1.35s ease-in-out infinite;
  border-radius: 8px;
}

.sk-line {
  height: 12px;
  width: 100%;
}

.sk-line.sk-title {
  width: 72px;
  height: 14px;
  margin-bottom: 4px;
}

.sk-line.sk-sm {
  width: 40%;
  height: 10px;
  margin-bottom: 6px;
}

.sk-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 14px;
}

.sk-field {
  min-width: 0;
}

.sk-ring {
  width: 88px;
  height: 88px;
  border-radius: 50% !important;
  margin: 12px auto 0;
}

.sk-bar-row {
  margin-top: 10px;
}

.sk-bar {
  height: 8px;
  width: 100%;
  border-radius: 999px !important;
  margin-top: 6px;
}

.sk-wave {
  height: 96px;
  width: 100%;
  border-radius: 14px !important;
  margin: 4px 0 10px;
}

.sk-chips {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-top: 4px;
}

.sk-chip {
  height: 56px;
  border-radius: 12px !important;
}

@keyframes sk-shimmer {
  0% {
    background-position: 120% 0;
  }
  100% {
    background-position: -80% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .sk-card .sk-line,
  .sk-card .sk-bar,
  .sk-card .sk-ring,
  .sk-card .sk-wave,
  .sk-card .sk-chip {
    animation: none;
  }
}

@media (max-width: 1100px) {
  .layout-grid {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
}

@media (max-width: 800px) {
  .card {
    grid-column: 1 / -1 !important;
  }

  .grid.info {
    grid-template-columns: 1fr;
  }
}
</style>
