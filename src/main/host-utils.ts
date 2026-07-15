import { createConnection } from 'net'
import { existsSync } from 'fs'
import { HostConfig, PrecheckResult } from '../shared/types'
import { store } from './store/encrypted-store'
import { expandHome } from './ssh-config'

export { expandHome, defaultSshConfigPath, parseSshConfig, linkProxyJumps, readTextFile } from './ssh-config'
export type { ParsedSshHost } from './ssh-config'

export function probeTcp(host: string, port: number, timeoutMs = 4000): Promise<boolean> {
  return new Promise((resolveOk) => {
    const socket = createConnection({ host, port })
    const done = (ok: boolean): void => {
      socket.removeAllListeners()
      socket.destroy()
      resolveOk(ok)
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
