import type { HostConfig, HostPublic, TrashHostItem, TrashHostPublic } from '../shared/types'

export function redactHost(host: HostConfig): HostPublic {
  const { password, passphrase, ...rest } = host
  return {
    ...rest,
    hasPassword: !!password,
    hasPassphrase: !!passphrase
  }
}

export function redactHosts(hosts: HostConfig[]): HostPublic[] {
  return hosts.map(redactHost)
}

export function redactTrash(items: TrashHostItem[]): TrashHostPublic[] {
  return items.map((t) => ({
    deletedAt: t.deletedAt,
    host: redactHost(t.host)
  }))
}

/** 保存时若未提交新密码，则保留库内旧密码 */
export function mergeHostSecrets(incoming: HostConfig, existing?: HostConfig): HostConfig {
  if (!existing) return incoming
  const next = { ...incoming }
  if (next.authType === 'password') {
    if (!next.password && existing.password) next.password = existing.password
  } else {
    if (!next.passphrase && existing.passphrase) next.passphrase = existing.passphrase
  }
  return next
}
