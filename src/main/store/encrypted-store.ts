import { app, safeStorage } from 'electron'
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes, randomUUID, scryptSync } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, copyFileSync } from 'fs'
import { join } from 'path'
import {
  AppSettings,
  COMMAND_HISTORY_MAX,
  DATABASE_HISTORY_MAX,
  DEFAULT_SETTINGS,
  DatabaseConnectionConfig,
  HostConfig,
  METRICS_LAYOUT_VERSION,
  SftpBookmark,
  TrashHostItem,
  VaultStatus,
  resolveMetricsLayout
} from '../../shared/types'

interface VaultPayload {
  hosts: HostConfig[]
  settings: AppSettings
  /** hostId → 命令列表（最近在前） */
  commandHistory: Record<string, string[]>
  bookmarks: SftpBookmark[]
  trashHosts: TrashHostItem[]
  databaseConnections: DatabaseConnectionConfig[]
  /** databaseConnectionId → SQL 列表（最近在前） */
  databaseHistory: Record<string, string[]>
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

function normalizeCommandHistory(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, string[]> = {}
  for (const [hostId, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!hostId || !Array.isArray(list)) continue
    out[hostId] = list
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .map((x) => x.trim())
      .slice(0, COMMAND_HISTORY_MAX)
  }
  return out
}

function normalizeDatabaseHistory(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, string[]> = {}
  for (const [connectionId, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!connectionId || !Array.isArray(list)) continue
    out[connectionId] = list
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .map((x) => x.trim())
      .slice(0, DATABASE_HISTORY_MAX)
  }
  return out
}

function normalizeDatabaseConnections(raw: unknown): DatabaseConnectionConfig[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((x): x is DatabaseConnectionConfig => {
      if (!x || typeof x !== 'object') return false
      const c = x as Partial<DatabaseConnectionConfig>
      return (
        typeof c.id === 'string' &&
        typeof c.hostId === 'string' &&
        typeof c.name === 'string' &&
        (c.driver === 'mysql' || c.driver === 'postgres') &&
        typeof c.dbHost === 'string' &&
        typeof c.username === 'string'
      )
    })
    .map((c) => ({
      ...c,
      dbPort: Number(c.dbPort) || (c.driver === 'postgres' ? 5432 : 3306),
      createdAt: Number(c.createdAt) || Date.now(),
      updatedAt: Number(c.updatedAt) || Date.now()
    }))
}

function normalizeVault(data: Partial<VaultPayload> & { snippets?: unknown }): VaultPayload {
  const settings = { ...DEFAULT_SETTINGS, ...(data.settings ?? {}) }
  return {
    hosts: data.hosts ?? [],
    settings: {
      ...settings,
      metricsLayout: resolveMetricsLayout(settings.metricsLayout, settings.metricsLayoutVersion),
      metricsLayoutVersion: METRICS_LAYOUT_VERSION
    },
    commandHistory: normalizeCommandHistory(data.commandHistory),
    bookmarks: data.bookmarks ?? [],
    trashHosts: data.trashHosts ?? [],
    databaseConnections: normalizeDatabaseConnections(data.databaseConnections),
    databaseHistory: normalizeDatabaseHistory(data.databaseHistory)
  }
}

export class EncryptedStore {
  private key: Buffer | null = null
  private cache: VaultPayload | null = null
  private protection: VaultProtection = 'password'
  private unlockFailures = 0
  private unlockLockedUntil = 0

  private assertUnlockAllowed(): void {
    const now = Date.now()
    if (now < this.unlockLockedUntil) {
      const wait = Math.ceil((this.unlockLockedUntil - now) / 1000)
      throw new Error(`尝试过多，请 ${wait} 秒后再试`)
    }
  }

  private recordUnlockFailure(): void {
    this.unlockFailures += 1
    if (this.unlockFailures >= 5) {
      this.unlockLockedUntil = Date.now() + 30_000
      this.unlockFailures = 0
      throw new Error('尝试过多，请 30 秒后再试')
    }
  }

  private recordUnlockSuccess(): void {
    this.unlockFailures = 0
    this.unlockLockedUntil = 0
  }

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
    this.assertUnlockAllowed()
    if (!this.isInitialized()) {
      throw new Error('尚未初始化保险库')
    }
    const raw = this.readFile()
    if ((raw.protection ?? 'password') === 'os') {
      throw new Error('当前为免密模式，请使用本机解锁')
    }
    const salt = Buffer.from(raw.salt, 'hex')
    const key = deriveKey(password, salt)
    try {
      this.openWithKey(key, raw)
      this.protection = 'password'
      this.recordUnlockSuccess()
    } catch (error) {
      this.recordUnlockFailure()
      throw error
    }
  }

  unlockOs(): void {
    this.assertUnlockAllowed()
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
      this.recordUnlockFailure()
      throw new Error('本机密钥解密失败（可能换过 Windows 用户或系统），请重置保险库')
    }
    const key = Buffer.from(keyB64, 'base64')
    try {
      this.openWithKey(key, raw, '本机密钥无效，请重置保险库')
      this.protection = 'os'
      this.recordUnlockSuccess()
    } catch (error) {
      this.recordUnlockFailure()
      throw error
    }
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
    const removedDbIds = this.cache!.databaseConnections
      .filter((c) => c.hostId === id)
      .map((c) => c.id)
    this.cache!.databaseConnections = this.cache!.databaseConnections.filter((c) => c.hostId !== id)
    for (const connectionId of removedDbIds) delete this.cache!.databaseHistory[connectionId]
    delete this.cache!.commandHistory[id]
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

  listCommandHistory(hostId: string): string[] {
    this.ensureUnlocked()
    return structuredClone(this.cache!.commandHistory[hostId] ?? [])
  }

  pushCommandHistory(hostId: string, command: string): string[] {
    this.ensureUnlocked()
    const cmd = command.trim()
    if (!hostId || !cmd) {
      return structuredClone(this.cache!.commandHistory[hostId] ?? [])
    }
    const prev = this.cache!.commandHistory[hostId] ?? []
    this.cache!.commandHistory[hostId] = [cmd, ...prev.filter((c) => c !== cmd)].slice(
      0,
      COMMAND_HISTORY_MAX
    )
    this.persist()
    return structuredClone(this.cache!.commandHistory[hostId])
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

  listDatabaseConnections(hostId?: string): DatabaseConnectionConfig[] {
    this.ensureUnlocked()
    const list = this.cache!.databaseConnections.filter((c) => !hostId || c.hostId === hostId)
    return structuredClone(list)
  }

  getDatabaseConnection(id: string): DatabaseConnectionConfig | undefined {
    this.ensureUnlocked()
    const connection = this.cache!.databaseConnections.find((c) => c.id === id)
    return connection ? structuredClone(connection) : undefined
  }

  saveDatabaseConnection(connection: DatabaseConnectionConfig): DatabaseConnectionConfig {
    this.ensureUnlocked()
    const now = Date.now()
    const payload: DatabaseConnectionConfig = {
      ...connection,
      dbPort: Number(connection.dbPort) || (connection.driver === 'postgres' ? 5432 : 3306),
      createdAt: connection.createdAt || now,
      updatedAt: now
    }
    const idx = this.cache!.databaseConnections.findIndex((c) => c.id === payload.id)
    if (idx >= 0) this.cache!.databaseConnections[idx] = payload
    else this.cache!.databaseConnections.push(payload)
    this.persist()
    return structuredClone(payload)
  }

  deleteDatabaseConnection(id: string): void {
    this.ensureUnlocked()
    this.cache!.databaseConnections = this.cache!.databaseConnections.filter((c) => c.id !== id)
    delete this.cache!.databaseHistory[id]
    this.persist()
  }

  listDatabaseHistory(connectionId: string): string[] {
    this.ensureUnlocked()
    return structuredClone(this.cache!.databaseHistory[connectionId] ?? [])
  }

  pushDatabaseHistory(connectionId: string, sql: string): string[] {
    this.ensureUnlocked()
    const value = sql.trim()
    if (!connectionId || !value) {
      return structuredClone(this.cache!.databaseHistory[connectionId] ?? [])
    }
    const prev = this.cache!.databaseHistory[connectionId] ?? []
    this.cache!.databaseHistory[connectionId] = [value, ...prev.filter((x) => x !== value)].slice(
      0,
      DATABASE_HISTORY_MAX
    )
    this.persist()
    return structuredClone(this.cache!.databaseHistory[connectionId])
  }

  deleteDatabaseHistoryItem(connectionId: string, sql: string): string[] {
    this.ensureUnlocked()
    const value = sql.trim()
    const prev = this.cache!.databaseHistory[connectionId] ?? []
    this.cache!.databaseHistory[connectionId] = prev.filter((item) => item !== value)
    this.persist()
    return structuredClone(this.cache!.databaseHistory[connectionId])
  }

  clearDatabaseHistory(connectionId: string): string[] {
    this.ensureUnlocked()
    this.cache!.databaseHistory[connectionId] = []
    this.persist()
    return []
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

  /** 导出已加密 vault.dat 副本（不含当前内存密钥） */
  exportTo(destPath: string): void {
    const src = vaultPath()
    if (!existsSync(src)) throw new Error('保险库文件不存在')
    copyFileSync(src, destPath)
  }

  /** 用备份覆盖本地库，导入后需重新解锁 */
  importFrom(srcPath: string): void {
    if (!existsSync(srcPath)) throw new Error('备份文件不存在')
    this.lock()
    copyFileSync(srcPath, vaultPath())
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

    writeFileSync(vaultPath() + '.tmp', JSON.stringify(file), 'utf8')
    renameSync(vaultPath() + '.tmp', vaultPath())
  }
}

export const store = new EncryptedStore()
