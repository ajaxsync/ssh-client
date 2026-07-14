import { createConnection } from 'net'
import { homedir } from 'os'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { HostConfig, PrecheckResult } from '../shared/types'
import { store } from './store/encrypted-store'

export function expandHome(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return join(homedir(), p.slice(2))
  }
  return p
}

export function probeTcp(host: string, port: number, timeoutMs = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port })
    const done = (ok: boolean): void => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

export async function precheckHost(host: HostConfig): Promise<PrecheckResult> {
  const messages: string[] = []
  let keyExists = true
  let jumpOk = true

  if (host.authType === 'privateKey') {
    const keyPath = host.privateKeyPath ? expandHome(host.privateKeyPath) : ''
    keyExists = !!keyPath && existsSync(keyPath)
    if (!keyExists) messages.push(`私钥不存在: ${host.privateKeyPath || '(未配置)'}`)
  }

  if (host.jumpHostId) {
    const jump = store.getHost(host.jumpHostId)
    if (!jump) {
      jumpOk = false
      messages.push('跳板机配置无效')
    } else {
      const jumpReachable = await probeTcp(jump.host, jump.port || 22)
      if (!jumpReachable) {
        jumpOk = false
        messages.push(`跳板机不可达: ${jump.host}:${jump.port || 22}`)
      }
      if (jump.authType === 'privateKey') {
        const jp = jump.privateKeyPath ? expandHome(jump.privateKeyPath) : ''
        if (!jp || !existsSync(jp)) {
          jumpOk = false
          messages.push(`跳板机私钥不存在: ${jump.privateKeyPath || ''}`)
        }
      }
    }
  }

  const directOk = host.jumpHostId ? true : await probeTcp(host.host, host.port || 22)
  const hostReachable = host.jumpHostId ? jumpOk : directOk
  if (!host.jumpHostId && !directOk) {
    messages.push(`主机不可达: ${host.host}:${host.port || 22}`)
  }

  const ok = keyExists && jumpOk && hostReachable
  if (ok) messages.push('预检通过')

  return { ok, hostReachable, keyExists, jumpOk, messages }
}

export function parseSshConfig(content: string): Array<{
  name: string
  host: string
  port: number
  username: string
  privateKeyPath?: string
  group?: string
}> {
  const blocks: Record<string, Record<string, string>> = {}
  let current: string | null = null

  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^(\w+)\s+(.+)$/i)
    if (!m) continue
    const key = m[1]
    const value = m[2].trim().replace(/^"|"$/g, '')
    if (/^host$/i.test(key)) {
      current = value.split(/\s+/)[0]
      if (!current || current.includes('*')) {
        current = null
        continue
      }
      blocks[current] = blocks[current] || {}
      continue
    }
    if (!current) continue
    blocks[current][key.toLowerCase()] = value
  }

  return Object.entries(blocks).map(([name, cfg]) => {
    const identity = cfg.identityfile ? expandHome(cfg.identityfile) : undefined
    return {
      name,
      host: cfg.hostname || name,
      port: Number(cfg.port) || 22,
      username: cfg.user || '',
      privateKeyPath: identity,
      group: 'ssh-config'
    }
  })
}

export function parseCsvHosts(content: string): Array<Partial<HostConfig> & { name: string; host: string }> {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (!lines.length) return []

  const header = lines[0].toLowerCase()
  const hasHeader = header.includes('host') && (header.includes('name') || header.includes('user'))
  const rows = hasHeader ? lines.slice(1) : lines

  return rows.map((line, idx) => {
    const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
    if (hasHeader) {
      const keys = header.split(',').map((k) => k.trim())
      const obj: Record<string, string> = {}
      keys.forEach((k, i) => {
        obj[k] = cols[i] || ''
      })
      return {
        name: obj.name || obj.host || `imported-${idx + 1}`,
        host: obj.host || obj.hostname || '',
        port: Number(obj.port) || 22,
        username: obj.username || obj.user || '',
        authType:
          (obj.authtype as HostConfig['authType']) ||
          (obj.privatekey || obj.key ? 'privateKey' : 'password'),
        privateKeyPath: obj.privatekey || obj.key || undefined,
        password: obj.password || undefined,
        group: obj.group || 'csv'
      }
    }
    return {
      name: cols[0] || `imported-${idx + 1}`,
      host: cols[1] || cols[0] || '',
      port: Number(cols[2]) || 22,
      username: cols[3] || '',
      authType: cols[4] === 'privateKey' ? 'privateKey' : 'password',
      privateKeyPath: cols[4] === 'privateKey' ? cols[5] : undefined,
      password: cols[4] === 'privateKey' ? undefined : cols[5],
      group: 'csv'
    }
  })
}

export function defaultSshConfigPath(): string {
  return join(homedir(), '.ssh', 'config')
}

export function readTextFile(path: string): string {
  return readFileSync(path, 'utf8')
}
