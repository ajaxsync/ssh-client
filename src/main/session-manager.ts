import { randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'
import { createWriteStream, createReadStream, readFileSync, existsSync } from 'fs'
import { basename, join, posix } from 'path'
import { Client, SFTPWrapper, ConnectConfig, ClientChannel } from 'ssh2'
import { AppSettings, HostConfig, SftpEntry, SftpListResult, TransferProgress } from '../shared/types'
import { expandHome } from './host-utils'
import { store } from './store/encrypted-store'
import { metricsCollector } from './metrics-collector'

interface ActiveSession {
  id: string
  hostId: string
  title: string
  client: Client
  jumpClient?: Client
  shell?: ClientChannel
  sftp?: SFTPWrapper
  /** 远端身份，用于估算读写权限 */
  identity?: { uid: number; gids: Set<number> }
}

export class SessionManager {
  private sessions = new Map<string, ActiveSession>()
  private window: BrowserWindow | null = null

  setWindow(win: BrowserWindow | null): void {
    this.window = win
  }

  async connect(
    host: HostConfig,
    cols = 80,
    rows = 24,
    settings?: AppSettings
  ): Promise<{ sessionId: string; title: string }> {
    const sessionId = randomUUID()
    const keepalive =
      host.keepaliveInterval !== undefined
        ? host.keepaliveInterval
        : (settings?.keepaliveInterval ?? 15000)

    const { client, jumpClient } = await this.openClient(host, keepalive)

    const shell = await new Promise<ClientChannel>((resolve, reject) => {
      client.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
        if (err) reject(err)
        else resolve(stream)
      })
    })

    const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
      client.sftp((err, sftpConn) => {
        if (err) reject(err)
        else resolve(sftpConn)
      })
    })

    const title = host.name || `${host.username}@${host.host}`
    const session: ActiveSession = {
      id: sessionId,
      hostId: host.id,
      title,
      client,
      jumpClient,
      shell,
      sftp
    }
    this.sessions.set(sessionId, session)

    shell.on('data', (data: Buffer) => {
      this.send('session:data', { sessionId, data: data.toString('base64') })
    })
    shell.stderr?.on('data', (data: Buffer) => {
      this.send('session:data', { sessionId, data: data.toString('base64') })
    })
    shell.on('close', () => {
      this.cleanup(sessionId, false)
      this.send('session:closed', { sessionId })
    })
    client.on('close', () => {
      this.cleanup(sessionId, false)
      this.send('session:closed', { sessionId })
    })
    client.on('error', (err) => {
      this.send('session:error', { sessionId, message: err.message })
    })

    return { sessionId, title }
  }

  write(sessionId: string, data: string): void {
    this.sessions.get(sessionId)?.shell?.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.sessions.get(sessionId)?.shell?.setWindow(rows, cols, 0, 0)
  }

  disconnect(sessionId: string): void {
    this.cleanup(sessionId, true)
  }

  startMetrics(sessionId: string, intervalMs = 2000): void {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('会话不存在')
    const host = store.listHosts().find((h) => h.id === session.hostId)
    metricsCollector.start(
      sessionId,
      session.client,
      (metrics) => {
        this.send('metrics:data', metrics)
      },
      intervalMs,
      { accessHost: host?.host }
    )
  }

  stopMetrics(sessionId: string): void {
    metricsCollector.stop(sessionId)
  }

  disconnectAll(): void {
    metricsCollector.stopAll()
    for (const id of [...this.sessions.keys()]) this.cleanup(id, true)
  }

  async list(sessionId: string, remotePath: string): Promise<SftpListResult> {
    const session = this.requireSession(sessionId)
    const sftp = this.requireSftp(sessionId)
    const identity = await this.ensureIdentity(session)

    const list = await new Promise<import('ssh2').FileEntry[]>((resolve, reject) => {
      sftp.readdir(remotePath, (err, list) => (err ? reject(err) : resolve(list)))
    })

    let canWrite = true
    try {
      const dirStats = await new Promise<import('ssh2').Stats>((resolve, reject) => {
        sftp.stat(remotePath, (err, stats) => (err ? reject(err) : resolve(stats)))
      })
      canWrite = hasPerm(dirStats.mode ?? 0, dirStats.uid ?? 0, dirStats.gid ?? 0, identity, 'w')
    } catch {
      // 部分路径（如 .）stat 失败时不阻断浏览
    }

    const entries = list
      .map((item) => {
        const mode = item.attrs.mode ?? 0
        const uid = item.attrs.uid ?? 0
        const gid = item.attrs.gid ?? 0
        const isDirectory = (mode & 0o170000) === 0o040000
        const base = remotePath === '.' ? '.' : remotePath.replace(/\/$/, '') || '/'
        return {
          name: item.filename,
          path: base === '.' ? `${item.filename}` : posix.join(base, item.filename),
          isDirectory,
          size: item.attrs.size ?? 0,
          modifyTime: (item.attrs.mtime ?? 0) * 1000,
          mode,
          uid,
          gid,
          canRead: hasPerm(mode, uid, gid, identity, 'r'),
          canWrite: hasPerm(mode, uid, gid, identity, 'w')
        } satisfies SftpEntry
      })
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        return a.name.localeCompare(b.name)
      })

    return { entries, canWrite }
  }

  async extract(sessionId: string, remotePath: string): Promise<void> {
    const session = this.requireSession(sessionId)
    const cmd = buildExtractCommand(remotePath)
    if (!cmd) throw new Error('暂不支持该压缩格式（支持 zip / tar / tar.gz / tgz / tar.bz2）')
    await this.execCommand(session.client, cmd)
  }

  /** 读取远端文本（等同 cat），过大截断 */
  async readTextFile(
    sessionId: string,
    remotePath: string,
    maxBytes = 1_500_000
  ): Promise<{ content: string; truncated: boolean; size: number }> {
    const sftp = this.requireSftp(sessionId)
    const stats = await new Promise<import('ssh2').Stats>((resolve, reject) => {
      sftp.stat(remotePath, (err, st) => (err ? reject(err) : resolve(st)))
    })
    const size = stats.size ?? 0
    if (((stats.mode ?? 0) & 0o170000) === 0o040000) {
      throw new Error('不能预览目录')
    }
    const buf = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = []
      let total = 0
      const stream = sftp.createReadStream(remotePath, { start: 0, end: Math.max(0, maxBytes - 1) })
      stream.on('data', (chunk: Buffer | string) => {
        const b = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
        total += b.length
        if (total <= maxBytes) chunks.push(b)
      })
      stream.on('error', reject)
      stream.on('close', () => resolve(Buffer.concat(chunks)))
    })
    if (buf.includes(0)) {
      throw new Error('该文件可能是二进制，不支持预览/编辑')
    }
    return {
      content: buf.toString('utf8'),
      truncated: size > maxBytes,
      size
    }
  }

  /** 写回远端文本（等同编辑后保存） */
  async writeTextFile(sessionId: string, remotePath: string, content: string): Promise<void> {
    const sftp = this.requireSftp(sessionId)
    const data = Buffer.from(content, 'utf8')
    await new Promise<void>((resolve, reject) => {
      const stream = sftp.createWriteStream(remotePath)
      stream.on('close', () => resolve())
      stream.on('error', reject)
      stream.end(data)
    })
  }

  async mkdir(sessionId: string, remotePath: string): Promise<void> {
    const sftp = this.requireSftp(sessionId)
    await new Promise<void>((resolve, reject) => {
      sftp.mkdir(remotePath, (err) => (err ? reject(err) : resolve()))
    })
  }

  async rename(sessionId: string, from: string, to: string): Promise<void> {
    const sftp = this.requireSftp(sessionId)
    await new Promise<void>((resolve, reject) => {
      sftp.rename(from, to, (err) => (err ? reject(err) : resolve()))
    })
  }

  async remove(sessionId: string, remotePath: string, isDirectory: boolean): Promise<void> {
    const sftp = this.requireSftp(sessionId)
    await new Promise<void>((resolve, reject) => {
      if (isDirectory) sftp.rmdir(remotePath, (err) => (err ? reject(err) : resolve()))
      else sftp.unlink(remotePath, (err) => (err ? reject(err) : resolve()))
    })
  }

  async upload(sessionId: string, localPath: string, remoteDir: string): Promise<string> {
    const sftp = this.requireSftp(sessionId)
    const filename = basename(localPath)
    const remotePath = posix.join(remoteDir.replace(/\/$/, '') || '/', filename)
    const transferId = randomUUID()
    const { size } = await import('fs/promises').then((fs) => fs.stat(localPath))

    await new Promise<void>((resolve, reject) => {
      const read = createReadStream(localPath)
      const write = sftp.createWriteStream(remotePath)
      let transferred = 0
      read.on('data', (chunk: Buffer | string) => {
        const len = typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
        transferred += len
        this.emitProgress({
          sessionId,
          transferId,
          filename,
          transferred,
          total: size,
          direction: 'upload'
        })
      })
      write.on('close', () => resolve())
      write.on('error', reject)
      read.on('error', reject)
      read.pipe(write)
    })
    return remotePath
  }

  async download(sessionId: string, remotePath: string, localDir: string): Promise<string> {
    const sftp = this.requireSftp(sessionId)
    const filename = basename(remotePath)
    const localPath = join(localDir, filename)
    const transferId = randomUUID()
    const attrs = await new Promise<import('ssh2').Stats>((resolve, reject) => {
      sftp.stat(remotePath, (err, stats) => (err ? reject(err) : resolve(stats)))
    })

    await new Promise<void>((resolve, reject) => {
      const read = sftp.createReadStream(remotePath)
      const write = createWriteStream(localPath)
      let transferred = 0
      read.on('data', (chunk: Buffer | string) => {
        const len = typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
        transferred += len
        this.emitProgress({
          sessionId,
          transferId,
          filename,
          transferred,
          total: attrs.size ?? 0,
          direction: 'download'
        })
      })
      write.on('close', () => resolve())
      write.on('error', reject)
      read.on('error', reject)
      read.pipe(write)
    })
    return localPath
  }

  private async openClient(
    host: HostConfig,
    keepaliveInterval: number
  ): Promise<{ client: Client; jumpClient?: Client }> {
    if (!host.jumpHostId) {
      const client = new Client()
      await this.connectClient(client, this.buildAuthConfig(host, keepaliveInterval))
      return { client }
    }

    const jump = store.getHost(host.jumpHostId)
    if (!jump) throw new Error('跳板机不存在')

    const jumpClient = new Client()
    await this.connectClient(jumpClient, this.buildAuthConfig(jump, keepaliveInterval))

    const stream = await new Promise<import('stream').Duplex>((resolve, reject) => {
      jumpClient.forwardOut('127.0.0.1', 0, host.host, host.port || 22, (err, s) => {
        if (err) reject(err)
        else resolve(s)
      })
    })

    const client = new Client()
    await this.connectClient(client, {
      ...this.buildAuthConfig(host, keepaliveInterval),
      sock: stream,
      host: undefined,
      port: undefined
    })
    return { client, jumpClient }
  }

  private connectClient(client: Client, config: ConnectConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      client
        .on('ready', () => resolve())
        .on('error', (err) => reject(err))
        .connect(config)
    })
  }

  private buildAuthConfig(host: HostConfig, keepaliveInterval: number): ConnectConfig {
    const base: ConnectConfig = {
      host: host.host,
      port: host.port || 22,
      username: host.username,
      readyTimeout: 25000,
      keepaliveInterval: keepaliveInterval > 0 ? keepaliveInterval : undefined
    }
    if (host.authType === 'password') {
      return { ...base, password: host.password || '' }
    }
    const keyPath = host.privateKeyPath ? expandHome(host.privateKeyPath) : ''
    if (!keyPath || !existsSync(keyPath)) throw new Error(`私钥不存在: ${host.privateKeyPath || ''}`)
    return {
      ...base,
      privateKey: readFileSync(keyPath),
      passphrase: host.passphrase
    }
  }

  private requireSftp(sessionId: string): SFTPWrapper {
    const session = this.requireSession(sessionId)
    if (!session.sftp) throw new Error('会话不存在或 SFTP 不可用')
    return session.sftp
  }

  private requireSession(sessionId: string): ActiveSession {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('会话不存在')
    return session
  }

  private async ensureIdentity(
    session: ActiveSession
  ): Promise<{ uid: number; gids: Set<number> } | null> {
    if (session.identity) return session.identity
    try {
      const out = await this.execCommand(session.client, 'id -u; id -G')
      const lines = out
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
      const uid = Number(lines[0])
      const gids = new Set(
        (lines[1] || '')
          .split(/\s+/)
          .map((x) => Number(x))
          .filter((n) => Number.isFinite(n))
      )
      if (!Number.isFinite(uid)) return null
      session.identity = { uid, gids }
      return session.identity
    } catch {
      return null
    }
  }

  private execCommand(client: Client, command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      client.exec(command, (err, stream) => {
        if (err) {
          reject(err)
          return
        }
        let stdout = ''
        let stderr = ''
        stream.on('data', (d: Buffer) => {
          stdout += d.toString('utf8')
        })
        stream.stderr?.on('data', (d: Buffer) => {
          stderr += d.toString('utf8')
        })
        stream.on('close', (code: number | null) => {
          if (code && code !== 0) {
            reject(new Error(stderr.trim() || stdout.trim() || `命令失败（退出码 ${code}）`))
            return
          }
          resolve(stdout)
        })
      })
    })
  }

  private cleanup(sessionId: string, endClient: boolean): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    metricsCollector.stop(sessionId)
    try {
      session.shell?.close()
    } catch {
      /* ignore */
    }
    if (endClient) {
      try {
        session.client.end()
      } catch {
        /* ignore */
      }
      try {
        session.jumpClient?.end()
      } catch {
        /* ignore */
      }
    }
    this.sessions.delete(sessionId)
  }

  private emitProgress(payload: TransferProgress): void {
    this.send('sftp:progress', payload)
  }

  private send(channel: string, payload: unknown): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, payload)
    }
  }
}

type RemoteIdentity = { uid: number; gids: Set<number> }

function hasPerm(
  mode: number,
  uid: number,
  gid: number,
  identity: RemoteIdentity | null,
  want: 'r' | 'w' | 'x'
): boolean {
  if (!identity) return true
  if (identity.uid === 0) return true
  const bit = want === 'r' ? 4 : want === 'w' ? 2 : 1
  const shift = identity.uid === uid ? 6 : identity.gids.has(gid) ? 3 : 0
  return ((mode >> shift) & bit) !== 0
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function buildExtractCommand(remotePath: string): string | null {
  const dir = posix.dirname(remotePath) || '.'
  const name = posix.basename(remotePath)
  const lower = name.toLowerCase()
  const qd = shellQuote(dir === '.' ? '.' : dir)
  const qn = shellQuote(name)
  if (lower.endsWith('.zip')) return `cd ${qd} && unzip -o ${qn}`
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return `cd ${qd} && tar -xzf ${qn}`
  if (lower.endsWith('.tar.bz2') || lower.endsWith('.tbz2')) return `cd ${qd} && tar -xjf ${qn}`
  if (lower.endsWith('.tar.xz')) return `cd ${qd} && tar -xJf ${qn}`
  if (lower.endsWith('.tar')) return `cd ${qd} && tar -xf ${qn}`
  return null
}

export const sessionManager = new SessionManager()
