import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { homedir } from 'os'
import type { HostConfig } from '../shared/types'

export function expandHome(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return join(homedir(), p.slice(2))
  }
  return p
}

export interface ParsedSshHost {
  name: string
  host: string
  port: number
  username: string
  privateKeyPath?: string
  group?: string
  proxyJump?: string
}

function expandIncludes(baseDir: string, pattern: string): string[] {
  const expanded = expandHome(pattern)
  const abs = resolve(baseDir, expanded)
  if (abs.includes('*') || abs.includes('?')) {
    const dir = dirname(abs)
    const filePat = abs.slice(dir.length + 1)
    if (!existsSync(dir)) return []
    const re = new RegExp(
      '^' +
        filePat
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.') +
        '$'
    )
    return readdirSync(dir)
      .filter((f) => re.test(f))
      .map((f) => join(dir, f))
      .filter((f) => {
        try {
          return statSync(f).isFile()
        } catch {
          return false
        }
      })
  }
  return existsSync(abs) ? [abs] : []
}

function parseSshConfigContent(
  content: string,
  baseDir: string,
  seenFiles: Set<string>
): ParsedSshHost[] {
  const blocks: Record<string, Record<string, string>> = {}
  let current: string | null = null
  const includes: string[] = []

  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^(\w+)\s+(.+)$/i)
    if (!m) continue
    const key = m[1]
    const value = m[2].trim().replace(/^"|"$/g, '')

    if (/^include$/i.test(key)) {
      includes.push(value)
      continue
    }

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

  const fromIncludes: ParsedSshHost[] = []
  for (const inc of includes) {
    for (const file of expandIncludes(baseDir, inc)) {
      const resolved = resolve(file)
      if (seenFiles.has(resolved)) continue
      seenFiles.add(resolved)
      try {
        fromIncludes.push(
          ...parseSshConfigContent(readFileSync(resolved, 'utf8'), dirname(resolved), seenFiles)
        )
      } catch {
        /* skip */
      }
    }
  }

  const local = Object.entries(blocks).map(([name, cfg]) => {
    const identity = cfg.identityfile ? expandHome(cfg.identityfile) : undefined
    let proxyJump = cfg.proxyjump || undefined
    if (proxyJump && /\s|,/.test(proxyJump)) {
      proxyJump = proxyJump.split(',')[0].trim()
    }
    return {
      name,
      host: cfg.hostname || name,
      port: Number(cfg.port) || 22,
      username: cfg.user || '',
      privateKeyPath: identity,
      group: 'ssh-config',
      proxyJump
    } satisfies ParsedSshHost
  })

  return [...fromIncludes, ...local]
}

export function defaultSshConfigPath(): string {
  return join(homedir(), '.ssh', 'config')
}

export function parseSshConfig(
  content: string,
  baseDir = dirname(defaultSshConfigPath())
): ParsedSshHost[] {
  return parseSshConfigContent(content, baseDir, new Set())
}

export function linkProxyJumps(hosts: HostConfig[], parsed: ParsedSshHost[]): HostConfig[] {
  const byName = new Map(hosts.map((h) => [h.name.toLowerCase(), h]))
  const byHost = new Map(hosts.map((h) => [`${h.host}:${h.port || 22}`.toLowerCase(), h]))

  return hosts.map((h) => {
    const src = parsed.find((p) => p.name === h.name)
    if (!src?.proxyJump) return h
    const jumpToken = src.proxyJump.replace(/^.*@/, '').split(':')[0]
    const jump =
      byName.get(src.proxyJump.toLowerCase()) ||
      byName.get(jumpToken.toLowerCase()) ||
      byHost.get(src.proxyJump.toLowerCase())
    if (!jump || jump.id === h.id) {
      return {
        ...h,
        note: [h.note, `ProxyJump: ${src.proxyJump}`].filter(Boolean).join('\n')
      }
    }
    return { ...h, jumpHostId: jump.id }
  })
}

export function readTextFile(path: string): string {
  return readFileSync(path, 'utf8')
}
