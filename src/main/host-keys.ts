import { createHash } from 'crypto'
import { app, dialog, BrowserWindow } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

export interface KnownHostEntry {
  host: string
  port: number
  /** sha256 base64 fingerprint */
  fingerprint: string
  acceptedAt: number
}

type KnownHostsFile = Record<string, KnownHostEntry>

function knownHostsPath(): string {
  const dir = join(app.getPath('userData'), 'security')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'known_hosts.json')
}

function hostKeyId(host: string, port: number): string {
  return `${host}:${port || 22}`
}

function loadAll(): KnownHostsFile {
  const p = knownHostsPath()
  if (!existsSync(p)) return {}
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as KnownHostsFile
  } catch {
    return {}
  }
}

function saveAll(data: KnownHostsFile): void {
  const p = knownHostsPath()
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(data, null, 2), 'utf8')
}

export function fingerprintSha256(key: Buffer): string {
  return createHash('sha256').update(key).digest('base64')
}

export function rememberHostKey(host: string, port: number, fingerprint: string): void {
  const all = loadAll()
  all[hostKeyId(host, port)] = {
    host,
    port: port || 22,
    fingerprint,
    acceptedAt: Date.now()
  }
  saveAll(all)
}

/** ssh2 SyncHostFingerprintVerifier（配合 hostHash: 'sha256'） */
export function createHostVerifier(
  host: string,
  port: number,
  getWindow: () => BrowserWindow | null
): (fingerprint: string) => boolean {
  const targetHost = host
  const targetPort = port || 22

  return (hashedKey: string): boolean => {
    const id = hostKeyId(targetHost, targetPort)
    const known = loadAll()[id]
    const fp = hashedKey.trim()

    if (known && known.fingerprint === fp) return true

    const win = getWindow()
    const changed = !!(known && known.fingerprint !== fp)
    const title = changed ? '主机密钥已变更' : '未知主机密钥'
    const detail = [
      `主机：${targetHost}:${targetPort}`,
      `指纹（SHA256）：${fp}`,
      changed
        ? '警告：与本机已记录的指纹不一致，可能存在中间人风险。仅在确认主机重装或密钥轮换后继续。'
        : '首次连接该主机。请确认指纹来自可信来源后再继续。'
    ].join('\n')

    const opts = {
      type: (changed ? 'warning' : 'question') as 'warning' | 'question',
      buttons: ['信任并继续', '取消'],
      defaultId: changed ? 1 : 0,
      cancelId: 1,
      title,
      message: title,
      detail
    }

    const result = win
      ? dialog.showMessageBoxSync(win, opts)
      : dialog.showMessageBoxSync(opts)

    if (result === 0) {
      rememberHostKey(targetHost, targetPort, fp)
      return true
    }
    return false
  }
}
