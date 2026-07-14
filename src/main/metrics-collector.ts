import type { Client } from 'ssh2'
import type {
  HostMetrics,
  MetricsDisk,
  MetricsGpu,
  MetricsListenPort,
  MetricsNetIface,
  MetricsProcess,
  MetricsServiceStatus
} from '../shared/types'

interface CpuSample {
  idle: number
  total: number
}

interface NetSample {
  [iface: string]: { rx: number; tx: number }
}

interface PrevSample {
  at: number
  cpu: CpuSample
  net: NetSample
}

interface KnownService {
  id: string
  name: string
  category: MetricsServiceStatus['category']
  ports: number[]
  processHints: string[]
}

const KNOWN_SERVICES: KnownService[] = [
  { id: 'ssh', name: 'SSH', category: 'other', ports: [22], processHints: ['sshd'] },
  {
    id: 'http',
    name: 'HTTP / Web',
    category: 'web',
    ports: [80, 8080, 8000],
    processHints: ['nginx', 'httpd', 'apache2', 'caddy', 'traefik']
  },
  {
    id: 'https',
    name: 'HTTPS',
    category: 'web',
    ports: [443, 8443],
    processHints: ['nginx', 'httpd', 'apache2', 'caddy', 'traefik']
  },
  {
    id: 'mysql',
    name: 'MySQL / MariaDB',
    category: 'database',
    ports: [3306],
    processHints: ['mysqld', 'mariadbd']
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    category: 'database',
    ports: [5432],
    processHints: ['postgres', 'postmaster']
  },
  {
    id: 'mongo',
    name: 'MongoDB',
    category: 'database',
    ports: [27017],
    processHints: ['mongod']
  },
  {
    id: 'redis',
    name: 'Redis',
    category: 'cache',
    ports: [6379],
    processHints: ['redis-server']
  },
  {
    id: 'memcached',
    name: 'Memcached',
    category: 'cache',
    ports: [11211],
    processHints: ['memcached']
  },
  {
    id: 'rabbitmq',
    name: 'RabbitMQ',
    category: 'message',
    ports: [5672, 15672],
    processHints: ['beam.smp', 'rabbitmq']
  },
  {
    id: 'elasticsearch',
    name: 'Elasticsearch',
    category: 'other',
    ports: [9200, 9300],
    processHints: ['java', 'elasticsearch']
  },
  {
    id: 'docker',
    name: 'Docker',
    category: 'other',
    ports: [2375, 2376],
    processHints: ['dockerd']
  }
]

/** Semicolon-joined so remote shell never eats `\n` escapes into literal `n`. */
const COLLECT_SCRIPT = [
  'echo __SYS__',
  'echo hostname=$(hostname 2>/dev/null)',
  'echo kernelName=$(uname -s 2>/dev/null)',
  'echo kernel=$(uname -r 2>/dev/null)',
  'echo arch=$(uname -m 2>/dev/null)',
  "awk '{print \"uptime=\" $1}' /proc/uptime 2>/dev/null || echo uptime=0",
  "awk '{print \"load=\" $1,$2,$3}' /proc/loadavg 2>/dev/null || echo load=0 0 0",
  "ip route 2>/dev/null | awk '/default/{print \"gateway=\" $3; exit}' || true",
  'echo cores=$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 0)',
  "awk -F: '/^model name/{gsub(/^[ \\t]+/,\"\",$2); print \"cpuModel=\" $2; exit}' /proc/cpuinfo 2>/dev/null || true",
  "awk -F: '/^Hardware/{gsub(/^[ \\t]+/,\"\",$2); print \"cpuModel=\" $2; exit}' /proc/cpuinfo 2>/dev/null || true",
  "date '+serverTime=%Y-%m-%d %H:%M:%S %Z' 2>/dev/null || true",
  "grep -E '^(NAME=|PRETTY_NAME=)' /etc/os-release 2>/dev/null | head -n 2 || true",
  'echo __CPU__',
  "grep '^cpu ' /proc/stat 2>/dev/null || true",
  'echo __MEM__',
  "grep -E '^(MemTotal|MemAvailable|MemFree|Buffers|Cached|SwapTotal|SwapFree):' /proc/meminfo 2>/dev/null || true",
  'echo __DISK__',
  'df -B1 -P -x tmpfs -x devtmpfs -x squashfs -x overlay 2>/dev/null | tail -n +2 || true',
  'echo __NET__',
  'cat /proc/net/dev 2>/dev/null | tail -n +3 || true',
  'echo __GPU__',
  'nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits 2>/dev/null || true',
  'echo __PORTS__',
  'ss -tlnp 2>/dev/null || ss -tln 2>/dev/null || netstat -tln 2>/dev/null || true',
  'echo __SIDECAR__',
  'pgrep -x dockerd >/dev/null 2>&1 && echo dockerd=1 || echo dockerd=0',
  'echo __PROC__',
  'ps -eo pid,user,%cpu,%mem,comm --sort=-%cpu 2>/dev/null | head -n 501 || true'
].join('; ')

function parseListenPorts(block: string): MetricsListenPort[] {
  const ports: MetricsListenPort[] = []
  const seen = new Set<string>()
  for (const line of block.split(/\n/)) {
    const cleaned = line.trim()
    if (!cleaned || /^State\b/i.test(cleaned) || /^Proto\b/i.test(cleaned)) continue
    if (!/LISTEN/i.test(cleaned) && !/^\w+\s+\d+\s+\d+\s+\S+:\d+/.test(cleaned)) {
      // netstat without LISTEN keyword in some formats still has local address
      if (!/:\d+(\s|$)/.test(cleaned)) continue
    }

    // Prefer ss local-address column: after Recv-Q Send-Q
    const parts = cleaned.split(/\s+/)
    let local = ''
    const listenIdx = parts.findIndex((p) => /LISTEN/i.test(p))
    if (listenIdx >= 0 && parts[listenIdx + 3]) local = parts[listenIdx + 3]
    else if (parts.length >= 4 && parts[3].includes(':')) local = parts[3]
    else {
      const hit = cleaned.match(/(\S+:\d+)\s+\S+/)
      if (hit) local = hit[1]
    }
    if (!local) continue

    const portMatch = local.match(/:(\d+)$/)
    if (!portMatch) continue
    const port = Number(portMatch[1])
    if (!port) continue

    let process = ''
    const procMatch = cleaned.match(/users:\(\("([^"]+)"/)
    if (procMatch) process = procMatch[1]

    const key = `tcp:${port}:${local}:${process}`
    if (seen.has(key)) continue
    seen.add(key)
    ports.push({ protocol: 'tcp', address: local, port, process })
  }
  return ports.sort((a, b) => a.port - b.port)
}

function detectServices(
  ports: MetricsListenPort[],
  sidecar: Record<string, string>
): MetricsServiceStatus[] {
  return KNOWN_SERVICES.map((svc) => {
    const hit = ports.find(
      (p) =>
        svc.ports.includes(p.port) ||
        (p.process &&
          svc.processHints.some((h) => p.process.toLowerCase().includes(h.toLowerCase())))
    )
    if (hit) {
      return {
        id: svc.id,
        name: svc.name,
        category: svc.category,
        ports: svc.ports,
        status: 'running' as const,
        process: hit.process || undefined,
        listenPort: hit.port
      }
    }
    if (svc.id === 'docker' && sidecar.dockerd === '1') {
      return {
        id: svc.id,
        name: svc.name,
        category: svc.category,
        ports: svc.ports,
        status: 'running' as const,
        process: 'dockerd'
      }
    }
    return {
      id: svc.id,
      name: svc.name,
      category: svc.category,
      ports: svc.ports,
      status: 'stopped' as const
    }
  })
}

function parseGpus(block: string): MetricsGpu[] {
  const gpus: MetricsGpu[] = []
  for (const line of block.split(/\n/).filter(Boolean)) {
    // e.g. 0, NVIDIA A10, 12, 1024, 23028, 41
    const parts = line.split(',').map((s) => s.trim())
    if (parts.length < 6) continue
    const index = Number(parts[0])
    if (Number.isNaN(index)) continue
    gpus.push({
      index,
      name: parts[1] || `GPU ${index}`,
      utilPercent: Number(parts[2]) || 0,
      memUsedMiB: Number(parts[3]) || 0,
      memTotalMiB: Number(parts[4]) || 0,
      tempC: Number(parts[5]) || 0
    })
  }
  return gpus
}

function parseKv(block: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of block.split(/\n/)) {
    const i = line.indexOf('=')
    if (i <= 0) continue
    const key = line.slice(0, i).trim()
    const val = line.slice(i + 1).trim()
    if (!key) continue
    if (!(key in out) || out[key] === '') out[key] = val
  }
  return out
}

function looksLikeIp(value: string): boolean {
  const v = value.trim()
  if (!v) return false
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) return true
  // rough IPv6 check
  if (v.includes(':') && /^[0-9a-fA-F:]+$/.test(v)) return true
  return false
}

function resolvePublicIp(accessHost: string | undefined, fetched: string): string {
  const access = (accessHost || '').trim()
  const pub = (fetched || '').trim()
  // 能用来连上服务器的地址优先（你在主机配置里填的 IP）
  if (looksLikeIp(access)) return access
  if (looksLikeIp(pub)) return pub
  if (access) return access
  return '-'
}

const PUBLIC_IP_PROBE =
  '(curl -4 -fsS --connect-timeout 2 --max-time 3 https://api.ipify.org || curl -4 -fsS --connect-timeout 2 --max-time 3 https://ifconfig.me/ip || curl -4 -fsS --connect-timeout 2 --max-time 3 https://icanhazip.com) 2>/dev/null | tr -d "\\r\\n "'

function execCommand(client: Client, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) return reject(err)
      let out = ''
      let errOut = ''
      stream.on('data', (d: Buffer) => {
        out += d.toString('utf8')
      })
      stream.stderr.on('data', (d: Buffer) => {
        errOut += d.toString('utf8')
      })
      stream.on('close', (code: number) => {
        if (code !== 0 && !out) reject(new Error(errOut || `exit ${code}`))
        else resolve(out)
      })
    })
  })
}

function parseMemKb(block: string, key: string): number {
  const m = block.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'))
  return m ? Number(m[1]) * 1024 : 0
}

function parseCpu(line: string): CpuSample | null {
  const parts = line.trim().split(/\s+/)
  if (parts[0] !== 'cpu' || parts.length < 5) return null
  const nums = parts.slice(1).map(Number)
  const idle = (nums[3] || 0) + (nums[4] || 0)
  const total = nums.reduce((a, b) => a + b, 0)
  return { idle, total }
}

function parseSection(text: string, name: string): string {
  const re = new RegExp(`__${name}__\\n([\\s\\S]*?)(?=__\\w+__\\n|$)`)
  const m = text.match(re)
  return m ? m[1].trim() : ''
}

export class MetricsCollector {
  private prev = new Map<string, PrevSample>()
  private timers = new Map<string, NodeJS.Timeout>()
  private accessHost = new Map<string, string>()
  private resolvedIp = new Map<string, string>()

  start(
    sessionId: string,
    client: Client,
    onData: (metrics: HostMetrics) => void,
    intervalMs = 2000,
    options?: { accessHost?: string }
  ): void {
    this.stop(sessionId)
    const access = options?.accessHost?.trim() || ''
    if (access) this.accessHost.set(sessionId, access)
    else this.accessHost.delete(sessionId)
    if (looksLikeIp(access)) this.resolvedIp.set(sessionId, access)
    else this.resolvedIp.delete(sessionId)

    const ensurePublicIp = async (): Promise<void> => {
      if (this.resolvedIp.has(sessionId)) return
      const accessHost = this.accessHost.get(sessionId)
      try {
        const fetched = (await execCommand(client, PUBLIC_IP_PROBE)).trim()
        this.resolvedIp.set(sessionId, resolvePublicIp(accessHost, fetched))
      } catch {
        this.resolvedIp.set(sessionId, resolvePublicIp(accessHost, ''))
      }
    }

    const tick = async (): Promise<void> => {
      try {
        await ensurePublicIp()
        const raw = await execCommand(client, COLLECT_SCRIPT)
        const metrics = this.parse(sessionId, raw)
        onData(metrics)
      } catch (error) {
        onData({
          sessionId,
          collectedAt: Date.now(),
          hostname: '-',
          os: '-',
          kernel: '-',
          arch: '-',
          primaryIp: this.resolvedIp.get(sessionId) || resolvePublicIp(this.accessHost.get(sessionId), ''),
          gateway: '-',
          cpuCores: 0,
          cpuModel: '-',
          serverTime: '-',
          uptimeSec: 0,
          load1: 0,
          load5: 0,
          load15: 0,
          cpuPercent: 0,
          memTotal: 0,
          memUsed: 0,
          memAvailable: 0,
          swapTotal: 0,
          swapUsed: 0,
          disks: [],
          nets: [],
          processes: [],
          listenPorts: [],
          services: [],
          gpus: [],
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
    void tick()
    this.timers.set(
      sessionId,
      setInterval(() => {
        void tick()
      }, intervalMs)
    )
  }

  stop(sessionId: string): void {
    const t = this.timers.get(sessionId)
    if (t) clearInterval(t)
    this.timers.delete(sessionId)
    this.prev.delete(sessionId)
    this.accessHost.delete(sessionId)
    this.resolvedIp.delete(sessionId)
  }

  stopAll(): void {
    for (const id of [...this.timers.keys()]) this.stop(id)
  }

  private parse(sessionId: string, raw: string): HostMetrics {
    const kv = parseKv(parseSection(raw, 'SYS'))
    const hostname = kv.hostname || '-'
    const kernelName = kv.kernelName || ''
    const kernel = kv.kernel || '-'
    const arch = kv.arch || '-'
    const uptimeSec = Number(kv.uptime) || 0
    const loadParts = (kv.load || '').split(/\s+/)
    const load1 = Number(loadParts[0]) || 0
    const load5 = Number(loadParts[1]) || 0
    const load15 = Number(loadParts[2]) || 0
    const primaryIp =
      this.resolvedIp.get(sessionId) ||
      resolvePublicIp(this.accessHost.get(sessionId), '')
    const gateway = kv.gateway || '-'
    const cpuCores = Number(kv.cores) || 0
    const cpuModel = kv.cpuModel || '-'
    const serverTime = kv.serverTime || '-'
    const os =
      (kv.PRETTY_NAME || kv.NAME || '').replace(/^"|"$/g, '') ||
      `${kernelName} ${kernel}`.trim() ||
      '-'

    const cpuLine = parseSection(raw, 'CPU').split(/\n/).find((l) => l.startsWith('cpu ')) || ''
    const cpuNow = parseCpu(cpuLine)
    let cpuPercent = 0
    const memBlock = parseSection(raw, 'MEM')
    const memTotal = parseMemKb(memBlock, 'MemTotal')
    const memAvailable =
      parseMemKb(memBlock, 'MemAvailable') ||
      parseMemKb(memBlock, 'MemFree') +
        parseMemKb(memBlock, 'Buffers') +
        parseMemKb(memBlock, 'Cached')
    const memUsed = Math.max(0, memTotal - memAvailable)
    const swapTotal = parseMemKb(memBlock, 'SwapTotal')
    const swapFree = parseMemKb(memBlock, 'SwapFree')
    const swapUsed = Math.max(0, swapTotal - swapFree)

    const disks: MetricsDisk[] = []
    for (const line of parseSection(raw, 'DISK').split(/\n/).filter(Boolean)) {
      const p = line.trim().split(/\s+/)
      if (p.length < 6) continue
      const size = Number(p[1]) || 0
      const used = Number(p[2]) || 0
      const avail = Number(p[3]) || 0
      const usedPercent = Number(String(p[4]).replace('%', '')) || (size ? (used / size) * 100 : 0)
      disks.push({
        filesystem: p[0],
        size,
        used,
        avail,
        usedPercent,
        mount: p[5]
      })
    }

    const netNow: NetSample = {}
    const nets: MetricsNetIface[] = []
    for (const line of parseSection(raw, 'NET').split(/\n/).filter(Boolean)) {
      const cleaned = line.trim()
      const idx = cleaned.indexOf(':')
      if (idx < 0) continue
      const name = cleaned.slice(0, idx).trim()
      if (!name || name === 'lo') continue
      const nums = cleaned
        .slice(idx + 1)
        .trim()
        .split(/\s+/)
        .map(Number)
      const rx = nums[0] || 0
      const tx = nums[8] || 0
      netNow[name] = { rx, tx }
      nets.push({ name, rxBytes: rx, txBytes: tx, rxRate: 0, txRate: 0 })
    }

    const processes: MetricsProcess[] = []
    const procLines = parseSection(raw, 'PROC').split(/\n/).filter(Boolean).slice(1)
    for (const line of procLines) {
      const m = line.trim().match(/^(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(.+)$/)
      if (!m) continue
      processes.push({
        pid: Number(m[1]),
        user: m[2],
        cpu: Number(m[3]) || 0,
        mem: Number(m[4]) || 0,
        command: m[5]
      })
    }

    const listenPorts = parseListenPorts(parseSection(raw, 'PORTS'))
    const sidecar = parseKv(parseSection(raw, 'SIDECAR'))
    const services = detectServices(listenPorts, sidecar)
    const gpus = parseGpus(parseSection(raw, 'GPU'))

    const now = Date.now()
    const prev = this.prev.get(sessionId)
    if (prev && cpuNow && prev.cpu.total > 0) {
      const dTotal = cpuNow.total - prev.cpu.total
      const dIdle = cpuNow.idle - prev.cpu.idle
      if (dTotal > 0) cpuPercent = Math.max(0, Math.min(100, (1 - dIdle / dTotal) * 100))
      const dt = Math.max(0.5, (now - prev.at) / 1000)
      for (const n of nets) {
        const p = prev.net[n.name]
        if (!p) continue
        n.rxRate = Math.max(0, (n.rxBytes - p.rx) / dt)
        n.txRate = Math.max(0, (n.txBytes - p.tx) / dt)
      }
    }

    if (cpuNow) {
      this.prev.set(sessionId, { at: now, cpu: cpuNow, net: netNow })
    }

    return {
      sessionId,
      collectedAt: now,
      hostname,
      os,
      kernel,
      arch,
      primaryIp,
      gateway,
      cpuCores,
      cpuModel,
      serverTime,
      uptimeSec,
      load1,
      load5,
      load15,
      cpuPercent,
      memTotal,
      memUsed,
      memAvailable,
      swapTotal,
      swapUsed,
      disks,
      nets,
      processes,
      listenPorts,
      services,
      gpus
    }
  }
}

export const metricsCollector = new MetricsCollector()
