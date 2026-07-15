import { describe, expect, it } from 'vitest'
import { compareSemver } from '../update-check'
import { parseSshConfig, linkProxyJumps } from '../ssh-config'
import { redactHost, mergeHostSecrets } from '../host-redact'
import type { HostConfig } from '../../shared/types'

describe('compareSemver', () => {
  it('compares versions', () => {
    expect(compareSemver('1.0.2', '1.0.1')).toBeGreaterThan(0)
    expect(compareSemver('1.0.0', '1.0.1')).toBeLessThan(0)
    expect(compareSemver('v1.2.0', '1.2.0')).toBe(0)
  })
})

describe('parseSshConfig', () => {
  it('parses Host / HostName / User / Port / IdentityFile / ProxyJump', () => {
    const parsed = parseSshConfig(`
Host jump
  HostName 10.0.0.1
  User jumpuser
  Port 22

Host app
  HostName 10.0.0.2
  User deploy
  IdentityFile ~/.ssh/id_ed25519
  ProxyJump jump
`)
    expect(parsed).toHaveLength(2)
    const app = parsed.find((p) => p.name === 'app')
    expect(app?.host).toBe('10.0.0.2')
    expect(app?.username).toBe('deploy')
    expect(app?.proxyJump).toBe('jump')
  })
})

describe('linkProxyJumps', () => {
  it('wires jumpHostId by name', () => {
    const parsed = parseSshConfig(`
Host jump
  HostName 10.0.0.1
  User j
Host app
  HostName 10.0.0.2
  User a
  ProxyJump jump
`)
    const hosts: HostConfig[] = parsed.map((p) => ({
      id: p.name,
      name: p.name,
      host: p.host,
      port: p.port,
      username: p.username,
      authType: 'password'
    }))
    const linked = linkProxyJumps(hosts, parsed)
    expect(linked.find((h) => h.name === 'app')?.jumpHostId).toBe('jump')
  })
})

describe('redactHost / mergeHostSecrets', () => {
  it('strips secrets and merges empty password', () => {
    const host: HostConfig = {
      id: '1',
      name: 'n',
      host: 'h',
      port: 22,
      username: 'u',
      authType: 'password',
      password: 'secret'
    }
    const publicHost = redactHost(host)
    expect(publicHost).not.toHaveProperty('password')
    expect(publicHost.hasPassword).toBe(true)

    const incoming: HostConfig = { ...host, password: '' }
    const merged = mergeHostSecrets(incoming, host)
    expect(merged.password).toBe('secret')
  })
})
