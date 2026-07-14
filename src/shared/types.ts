export type AuthType = 'password' | 'privateKey'
export type ThemeMode = 'dark' | 'light'
export type TabColor =
  | 'default'
  | 'blue'
  | 'teal'
  | 'amber'
  | 'rose'
  | 'violet'
  | 'lime'

export interface HostConfig {
  id: string
  name: string
  host: string
  port: number
  username: string
  authType: AuthType
  password?: string
  privateKeyPath?: string
  passphrase?: string
  group?: string
  note?: string
  color?: TabColor
  /** 跳板机主机 ID（ProxyJump） */
  jumpHostId?: string
  /** 覆盖全局 keepalive（毫秒），0 表示禁用 */
  keepaliveInterval?: number
  lastConnectedAt?: number
}

export interface Snippet {
  id: string
  title: string
  command: string
  category?: string
}

export interface SftpBookmark {
  id: string
  label: string
  path: string
  hostId?: string
}

export interface TrashHostItem {
  host: HostConfig
  deletedAt: number
}

export interface AppSettings {
  fontSize: number
  theme: ThemeMode
  /** SSH keepalive 间隔（毫秒） */
  keepaliveInterval: number
  autoReconnect: boolean
  autoReconnectDelayMs: number
  autoReconnectMaxAttempts: number
  /** 监控面板卡片布局（顺序 + 每行个数） */
  metricsLayout: MetricsLayoutItem[]
  /** 布局版本；过低时使用最新默认布局 */
  metricsLayoutVersion: number
}

export type MetricsCardId =
  | 'system'
  | 'cpu'
  | 'mem'
  | 'disk'
  | 'net'
  | 'gpu'
  | 'services'
  | 'ports'
  | 'proc'
/** 该卡片占满一行时一行可放几个：1=整行，2=半宽，3=三分之一 */
export type MetricsCardCols = 1 | 2 | 3

export interface MetricsLayoutItem {
  id: MetricsCardId
  cols: MetricsCardCols
  /** 同一 stack 内竖直堆叠（共用半行宽度） */
  stack?: string
  /** 堆叠内的行号；同行卡片横向并排 */
  stackRow?: number
}

export interface VaultStatus {
  initialized: boolean
  unlocked: boolean
  /** 保护方式：主密码 / 本机系统保护（免输密码） */
  protection: 'password' | 'os' | null
  /** 当前环境是否支持本机自动解锁 */
  osUnlockAvailable: boolean
  /** 已是本机保护模式且可自动解锁 */
  canAutoUnlock: boolean
}

export interface SessionInfo {
  sessionId: string
  hostId: string
  title: string
}

export interface PrecheckResult {
  ok: boolean
  hostReachable: boolean
  keyExists: boolean
  jumpOk: boolean
  messages: string[]
}

export interface SftpEntry {
  name: string
  path: string
  isDirectory: boolean
  size: number
  modifyTime: number
  /** unix mode（含类型位） */
  mode?: number
  uid?: number
  gid?: number
  /** 当前用户可读 */
  canRead: boolean
  /** 当前用户可写（文件/目录自身权限位） */
  canWrite: boolean
}

export interface SftpListResult {
  entries: SftpEntry[]
  /** 当前目录是否可写（上传 / 新建 / 改名 / 删除） */
  canWrite: boolean
}

export interface TransferProgress {
  sessionId: string
  transferId: string
  filename: string
  transferred: number
  total: number
  direction: 'upload' | 'download'
}

export interface MetricsDisk {
  mount: string
  filesystem: string
  size: number
  used: number
  avail: number
  usedPercent: number
}

export interface MetricsNetIface {
  name: string
  rxBytes: number
  txBytes: number
  rxRate: number
  txRate: number
}

export interface MetricsProcess {
  pid: number
  user: string
  cpu: number
  mem: number
  command: string
}

export interface MetricsListenPort {
  protocol: 'tcp' | 'udp'
  address: string
  port: number
  process: string
}

export type MetricsServiceCategory = 'web' | 'database' | 'cache' | 'message' | 'other'

export interface MetricsServiceStatus {
  id: string
  name: string
  category: MetricsServiceCategory
  /** 关联端口（用于探测） */
  ports: number[]
  status: 'running' | 'stopped'
  process?: string
  listenPort?: number
}

export interface MetricsGpu {
  index: number
  name: string
  utilPercent: number
  memUsedMiB: number
  memTotalMiB: number
  tempC: number
}

export interface HostMetrics {
  sessionId: string
  collectedAt: number
  hostname: string
  os: string
  kernel: string
  arch: string
  /** 公网/访问 IP（优先连接地址，其次远端探测） */
  primaryIp: string
  /** 默认网关 */
  gateway: string
  /** CPU 逻辑核数 */
  cpuCores: number
  /** CPU 型号 */
  cpuModel: string
  /** 远端本机时间字符串 */
  serverTime: string
  uptimeSec: number
  load1: number
  load5: number
  load15: number
  cpuPercent: number
  memTotal: number
  memUsed: number
  memAvailable: number
  swapTotal: number
  swapUsed: number
  disks: MetricsDisk[]
  nets: MetricsNetIface[]
  processes: MetricsProcess[]
  listenPorts: MetricsListenPort[]
  services: MetricsServiceStatus[]
  gpus: MetricsGpu[]
  error?: string
}

export const METRICS_LAYOUT_VERSION = 4

/** 第1行：系统 | (上:CPU+内存环 / 下:磁盘)；第2行：网络|服务；第3行：端口|进程。不含 GPU。 */
export const DEFAULT_METRICS_LAYOUT: MetricsLayoutItem[] = [
  { id: 'system', cols: 2 },
  { id: 'cpu', cols: 2, stack: 'side', stackRow: 0 },
  { id: 'mem', cols: 2, stack: 'side', stackRow: 0 },
  { id: 'disk', cols: 2, stack: 'side', stackRow: 1 },
  { id: 'net', cols: 2 },
  { id: 'services', cols: 2 },
  { id: 'ports', cols: 2 },
  { id: 'proc', cols: 2 }
]

const METRICS_CARD_IDS: MetricsCardId[] = [
  'system',
  'cpu',
  'mem',
  'disk',
  'net',
  'services',
  'ports',
  'proc'
]

export function normalizeMetricsLayout(input?: MetricsLayoutItem[] | null): MetricsLayoutItem[] {
  const map = new Map<MetricsCardId, Pick<MetricsLayoutItem, 'cols' | 'stack' | 'stackRow'>>()
  for (const item of input || []) {
    if (!METRICS_CARD_IDS.includes(item.id)) continue
    const cols = item.cols === 2 || item.cols === 3 ? item.cols : 1
    map.set(item.id, {
      cols,
      ...(item.stack ? { stack: item.stack, stackRow: item.stackRow ?? 0 } : {})
    })
  }
  const ordered: MetricsLayoutItem[] = []
  for (const item of input || []) {
    if (!map.has(item.id)) continue
    const meta = map.get(item.id)!
    ordered.push({ id: item.id, ...meta })
    map.delete(item.id)
  }
  for (const id of METRICS_CARD_IDS) {
    if (map.has(id)) {
      ordered.push({ id, ...map.get(id)! })
      map.delete(id)
    } else if (!ordered.some((x) => x.id === id)) {
      const fallback = DEFAULT_METRICS_LAYOUT.find((x) => x.id === id)!
      ordered.push({ ...fallback })
    }
  }
  return ordered
}

/** Apply default layout when version is outdated. */
export function resolveMetricsLayout(
  layout?: MetricsLayoutItem[] | null,
  version?: number | null
): MetricsLayoutItem[] {
  if (!version || version < METRICS_LAYOUT_VERSION) {
    return DEFAULT_METRICS_LAYOUT.map((x) => ({ ...x }))
  }
  return normalizeMetricsLayout(layout)
}

export const DEFAULT_SETTINGS: AppSettings = {
  fontSize: 14,
  theme: 'dark',
  keepaliveInterval: 15000,
  autoReconnect: true,
  autoReconnectDelayMs: 2000,
  autoReconnectMaxAttempts: 5,
  metricsLayout: DEFAULT_METRICS_LAYOUT.map((x) => ({ ...x })),
  metricsLayoutVersion: METRICS_LAYOUT_VERSION
}

export const TAB_COLORS: { id: TabColor; label: string; value: string }[] = [
  { id: 'default', label: '默认', value: '#6cb6ff' },
  { id: 'blue', label: '蓝', value: '#5b9dff' },
  { id: 'teal', label: '青', value: '#2dd4bf' },
  { id: 'amber', label: '琥珀', value: '#fbbf24' },
  { id: 'rose', label: '玫红', value: '#fb7185' },
  { id: 'violet', label: '紫', value: '#a78bfa' },
  { id: 'lime', label: 'Lime', value: '#a3e635' }
]
