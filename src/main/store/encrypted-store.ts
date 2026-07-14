import { app, safeStorage } from 'electron'
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes, randomUUID, scryptSync } from 'crypto'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  AppSettings,
  DEFAULT_SETTINGS,
  HostConfig,
  METRICS_LAYOUT_VERSION,
  SftpBookmark,
  Snippet,
  TrashHostItem,
  VaultStatus,
  resolveMetricsLayout
} from '../../shared/types'

interface VaultPayload {
  hosts: HostConfig[]
  settings: AppSettings
  snippets: Snippet[]
  bookmarks: SftpBookmark[]
  trashHosts: TrashHostItem[]
}

type VaultProtection = 'password' | 'os'

interface EncryptedFile {
  /** 缺省视为 password，兼容旧库 */
  protection?: VaultProtection
  salt: string
  iv: string
  tag: string
  data: string
  verifier: string
  /** OS 模式：safeStorage 加密后的密钥（base64） */
  wrappedKey?: string
}

const MAX_TRASH = 50

const DATA_DIR = (): string => {
  const dir = join(app.getPath('userData'), 'vault')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

const vaultPath = (): string => join(DATA_DIR(), 'vault.dat')

function deriveKey(password: string, salt: Buffer): Buffer {
  return pbkdf2Sync(password, salt, 120000, 32, 'sha512')
}

function makeVerifier(key: Buffer): string {
  return scryptSync(key, 'ssh-client-verifier', 32).toString('hex')
}

function normalizeVault(data: Partial<VaultPayload>): VaultPayload {
  const settings = { ...DEFAULT_SETTINGS, ...(data.settings ?? {}) }
  return {
    hosts: data.hosts ?? [],
    settings: {
      ...settings,
      metricsLayout: resolveMetricsLayout(settings.metricsLayout, settings.metricsLayoutVersion),
      metricsLayoutVersion: METRICS_LAYOUT_VERSION
    },
    snippets: data.snippets ?? [],
    bookmarks: data.bookmarks ?? [],
    trashHosts: data.trashHosts ?? []
  }
}

export class EncryptedStore {
  private key: Buffer | null = null
  private cache: VaultPayload | null = null
  private protection: VaultProtection = 'password'

  isInitialized(): boolean {
    return existsSync(vaultPath())
  }

  isUnlocked(): boolean {
    return this.key !== null && this.cache !== null
  }

  isOsUnlockAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  getProtection(): VaultProtection | null {
    if (!this.isInitialized()) return null
    if (this.isUnlocked()) return this.protection
    return this.readFile().protection ?? 'password'
  }

  canAutoUnlock(): boolean {
    return this.getProtection() === 'os' && this.isOsUnlockAvailable()
  }

  status(): VaultStatus {
    const protection = this.getProtection()
    const osUnlockAvailable = this.isOsUnlockAvailable()
    return {
      initialized: this.isInitialized(),
      unlocked: this.isUnlocked(),
      protection,
      osUnlockAvailable,
      canAutoUnlock: protection === 'os' && osUnlockAvailable
    }
  }

  setup(password: string): void {
    if (this.isInitialized()) {
      throw new Error('保险库已存在，请直接解锁')
    }
    const salt = randomBytes(16)
    this.key = deriveKey(password, salt)
    this.protection = 'password'
    this.cache = normalizeVault({})
    this.persist(salt)
  }

  /** 本机自动解锁：随机密钥由系统凭据保护，无需主密码 */
  setupOs(): void {
    if (this.isInitialized()) {
      throw new Error('保险库已存在，请直接解锁')
    }
    if (!this.isOsUnlockAvailable()) {
      throw new Error('当前系统不支持本机自动解锁，请改用主密码')
    }
    this.key = randomBytes(32)
    this.protection = 'os'
    this.cache = normalizeVault({})
    this.persist(randomBytes(16))
  }

  unlock(password: string): void {
    if (!this.isInitialized()) {
      throw new Error('尚未初始化保险库')
    }
    const raw = this.readFile()
    if ((raw.protection ?? 'password') === 'os') {
      throw new Error('当前为免密模式，请使用本机解锁')
    }
    const salt = Buffer.from(raw.salt, 'hex')
    const key = deriveKey(password, salt)
    this.openWithKey(key, raw)
    this.protection = 'password'
  }

  unlockOs(): void {
    if (!this.isInitialized()) {
      throw new Error('尚未初始化保险库')
    }
    if (!this.isOsUnlockAvailable()) {
      throw new Error('当前系统不支持本机自动解锁')
    }
    const raw = this.readFile()
    if ((raw.protection ?? 'password') !== 'os') {
      throw new Error('当前为主密码模式')
    }
    if (!raw.wrappedKey) {
      throw new Error('缺少本机密钥，请重置保险库后重试')
    }
    let keyB64: string
    try {
      keyB64 = safeStorage.decryptString(Buffer.from(raw.wrappedKey, 'base64'))
    } catch {
      throw new Error('本机密钥解密失败（可能换过 Windows 用户或系统），请重置保险库')
    }
    const key = Buffer.from(keyB64, 'base64')
    this.openWithKey(key, raw, '本机密钥无效，请重置保险库')
    this.protection = 'os'
  }

  /** 忘记主密码：删除保险库，不可恢复 */
  reset(): void {
    this.key = null
    this.cache = null
    this.protection = 'password'
    if (existsSync(vaultPath())) unlinkSync(vaultPath())
  }

  lock(): void {
    this.key = null
    this.cache = null
  }

  listHosts(): HostConfig[] {
    this.ensureUnlocked()
    return structuredClone(this.cache!.hosts)
  }

  saveHost(host: HostConfig): HostConfig {
    this.ensureUnlocked()
    const idx = this.cache!.hosts.findIndex((h) => h.id === host.id)
    if (idx >= 0) this.cache!.hosts[idx] = host
    else this.cache!.hosts.push(host)
    this.persist()
    return structuredClone(host)
  }

  saveHosts(hosts: HostConfig[]): HostConfig[] {
    this.ensureUnlocked()
    for (const host of hosts) {
      const idx = this.cache!.hosts.findIndex((h) => h.id === host.id)
      if (idx >= 0) this.cache!.hosts[idx] = host
      else this.cache!.hosts.push(host)
    }
    this.persist()
    return structuredClone(hosts)
  }

  /** 软删除进回收站 */
  deleteHost(id: string): void {
    this.ensureUnlocked()
    const host = this.cache!.hosts.find((h) => h.id === id)
    if (!host) return
    this.cache!.hosts = this.cache!.hosts.filter((h) => h.id !== id)
    this.cache!.bookmarks = this.cache!.bookmarks.filter((b) => b.hostId !== id)
    for (const h of this.cache!.hosts) {
      if (h.jumpHostId === id) h.jumpHostId = undefined
    }
    this.cache!.trashHosts = [
      { host: structuredClone(host), deletedAt: Date.now() },
      ...this.cache!.trashHosts.filter((t) => t.host.id !== id)
    ].slice(0, MAX_TRASH)
    this.persist()
  }

  listTrashHosts(): TrashHostItem[] {
    this.ensureUnlocked()
    return structuredClone(this.cache!.trashHosts)
  }

  restoreHost(id: string): HostConfig {
    this.ensureUnlocked()
    const idx = this.cache!.trashHosts.findIndex((t) => t.host.id === id)
    if (idx < 0) throw new Error('回收站中不存在该主机')
    const item = this.cache!.trashHosts[idx]
    this.cache!.trashHosts.splice(idx, 1)
    const exists = this.cache!.hosts.some((h) => h.id === item.host.id)
    if (exists) item.host.id = randomUUID()
    this.cache!.hosts.push(item.host)
    this.persist()
    return structuredClone(item.host)
  }

  purgeHost(id: string): void {
    this.ensureUnlocked()
    this.cache!.trashHosts = this.cache!.trashHosts.filter((t) => t.host.id !== id)
    this.persist()
  }

  emptyTrash(): void {
    this.ensureUnlocked()
    this.cache!.trashHosts = []
    this.persist()
  }

  getHost(id: string): HostConfig | undefined {
    this.ensureUnlocked()
    const host = this.cache!.hosts.find((h) => h.id === id)
    return host ? structuredClone(host) : undefined
  }

  touchHost(id: string): void {
    this.ensureUnlocked()
    const host = this.cache!.hosts.find((h) => h.id === id)
    if (host) {
      host.lastConnectedAt = Date.now()
      this.persist()
    }
  }

  getSettings(): AppSettings {
    this.ensureUnlocked()
    const s = this.cache!.settings
    const version = s.metricsLayoutVersion || 0
    const layout = resolveMetricsLayout(s.metricsLayout, version)
    if (version < METRICS_LAYOUT_VERSION) {
      this.cache!.settings = {
        ...DEFAULT_SETTINGS,
        ...s,
        metricsLayout: layout,
        metricsLayoutVersion: METRICS_LAYOUT_VERSION
      }
      this.persist()
    }
    return structuredClone(this.cache!.settings)
  }

  setSettings(settings: AppSettings): AppSettings {
    this.ensureUnlocked()
    const version = settings.metricsLayoutVersion || 0
    this.cache!.settings = {
      ...DEFAULT_SETTINGS,
      ...settings,
      metricsLayout: resolveMetricsLayout(settings.metricsLayout, version),
      metricsLayoutVersion: METRICS_LAYOUT_VERSION
    }
    this.persist()
    return structuredClone(this.cache!.settings)
  }

  listSnippets(): Snippet[] {
    this.ensureUnlocked()
    return structuredClone(this.cache!.snippets)
  }

  saveSnippet(snippet: Snippet): Snippet {
    this.ensureUnlocked()
    const idx = this.cache!.snippets.findIndex((s) => s.id === snippet.id)
    if (idx >= 0) this.cache!.snippets[idx] = snippet
    else this.cache!.snippets.push(snippet)
    this.persist()
    return structuredClone(snippet)
  }

  deleteSnippet(id: string): void {
    this.ensureUnlocked()
    this.cache!.snippets = this.cache!.snippets.filter((s) => s.id !== id)
    this.persist()
  }

  listBookmarks(hostId?: string): SftpBookmark[] {
    this.ensureUnlocked()
    const list = this.cache!.bookmarks.filter((b) => !hostId || !b.hostId || b.hostId === hostId)
    return structuredClone(list)
  }

  saveBookmark(bookmark: SftpBookmark): SftpBookmark {
    this.ensureUnlocked()
    const idx = this.cache!.bookmarks.findIndex((b) => b.id === bookmark.id)
    if (idx >= 0) this.cache!.bookmarks[idx] = bookmark
    else this.cache!.bookmarks.push(bookmark)
    this.persist()
    return structuredClone(bookmark)
  }

  deleteBookmark(id: string): void {
    this.ensureUnlocked()
    this.cache!.bookmarks = this.cache!.bookmarks.filter((b) => b.id !== id)
    this.persist()
  }

  private readFile(): EncryptedFile {
    return JSON.parse(readFileSync(vaultPath(), 'utf8')) as EncryptedFile
  }

  private openWithKey(key: Buffer, raw: EncryptedFile, badKeyMsg = '主密码错误'): void {
    if (makeVerifier(key) !== raw.verifier) {
      throw new Error(badKeyMsg)
    }
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(raw.iv, 'hex'))
    decipher.setAuthTag(Buffer.from(raw.tag, 'hex'))
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(raw.data, 'hex')),
      decipher.final()
    ]).toString('utf8')
    this.key = key
    this.cache = normalizeVault(JSON.parse(decrypted) as Partial<VaultPayload>)
  }

  private ensureUnlocked(): void {
    if (!this.isUnlocked()) throw new Error('保险库未解锁')
  }

  private persist(existingSalt?: Buffer): void {
    if (!this.key || !this.cache) throw new Error('无法保存')
    let salt = existingSalt
    if (!salt && existsSync(vaultPath())) {
      const raw = this.readFile()
      salt = Buffer.from(raw.salt, 'hex')
    }
    if (!salt) salt = randomBytes(16)

    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const encrypted = Buffer.concat([
      cipher.update(Buffer.from(JSON.stringify(this.cache), 'utf8')),
      cipher.final()
    ])

    const file: EncryptedFile = {
      protection: this.protection,
      salt: salt.toString('hex'),
      iv: iv.toString('hex'),
      tag: cipher.getAuthTag().toString('hex'),
      data: encrypted.toString('hex'),
      verifier: makeVerifier(this.key)
    }

    if (this.protection === 'os') {
      if (!this.isOsUnlockAvailable()) {
        throw new Error('本机加密不可用，无法保存免密保险库')
      }
      file.wrappedKey = safeStorage.encryptString(this.key.toString('base64')).toString('base64')
    }

    writeFileSync(vaultPath(), JSON.stringify(file), 'utf8')
  }
}

export const store = new EncryptedStore()
