import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { randomUUID } from 'crypto'
import { existsSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import {
  AppSettings,
  DatabaseConnectionConfig,
  HostConfig,
  SftpBookmark
} from '../shared/types'
import { store } from './store/encrypted-store'
import { sessionManager } from './session-manager'
import { databaseManager } from './database-manager'
import {
  defaultSshConfigPath,
  linkProxyJumps,
  parseSshConfig,
  precheckHost,
  readTextFile
} from './host-utils'
import { checkGitHubUpdate } from './update-check'
import { mergeHostSecrets, redactHost, redactHosts, redactTrash } from './host-redact'
import {
  mergeDatabaseSecrets,
  redactDatabaseConnection,
  redactDatabaseConnections
} from './database-redact'

function ok<T>(data: T): { ok: true; data: T }
function ok(): { ok: true }
function ok<T>(data?: T) {
  return data === undefined ? { ok: true as const } : { ok: true as const, data }
}

function isAllowedExternalUrl(url: string): boolean {
  return url.startsWith('https://github.com/ajaxsync/ssh-client')
}

function fail(error: unknown): { ok: false; error: string } {
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, error: message }
}

function buildCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const escapeCell = (value: unknown): string => {
    if (value === null || value === undefined) return ''
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    return `"${String(text ?? '').replace(/"/g, '""')}"`
  }
  return [
    columns.map(escapeCell).join(','),
    ...rows.map((row) => columns.map((column) => escapeCell(row[column])).join(','))
  ].join('\r\n')
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('app:version', () => ok(app.getVersion()))

  ipcMain.handle('app:checkUpdate', async () => {
    try {
      return ok(await checkGitHubUpdate(app.getVersion()))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('shell:openExternal', async (_e, url: string) => {
    try {
      if (typeof url !== 'string' || !isAllowedExternalUrl(url)) {
        throw new Error('不允许打开该链接')
      }
      await shell.openExternal(url)
      return ok()
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('vault:status', () => ok(store.status()))

  ipcMain.handle('vault:setup', (_e, password: string) => {
    try {
      store.setup(password)
      return ok()
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('vault:setupOs', () => {
    try {
      store.setupOs()
      return ok()
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('vault:unlock', (_e, password: string) => {
    try {
      store.unlock(password)
      return ok()
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('vault:unlockOs', () => {
    try {
      store.unlockOs()
      return ok()
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('vault:tryAutoUnlock', () => {
    try {
      if (store.canAutoUnlock() && !store.isUnlocked()) {
        store.unlockOs()
      }
      return ok(store.status())
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('vault:lock', () => {
    databaseManager.disconnectAll()
    sessionManager.disconnectAll()
    store.lock()
    return ok()
  })

  ipcMain.handle('vault:reset', () => {
    try {
      databaseManager.disconnectAll()
      sessionManager.disconnectAll()
      store.reset()
      return ok()
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('hosts:list', () => {
    try {
      return ok(redactHosts(store.listHosts()))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('hosts:get', (_e, id: string) => {
    try {
      const host = store.getHost(id)
      if (!host) throw new Error('主机不存在')
      return ok(host)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('hosts:save', (_e, host: HostConfig) => {
    try {
      const existing = store.getHost(host.id)
      const merged = mergeHostSecrets(host, existing)
      return ok(redactHost(store.saveHost(merged)))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('hosts:delete', (_e, id: string) => {
    try {
      store.deleteHost(id)
      return ok()
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('trash:list', () => {
    try {
      return ok(redactTrash(store.listTrashHosts()))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('trash:restore', (_e, id: string) => {
    try {
      return ok(redactHost(store.restoreHost(id)))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('trash:purge', (_e, id: string) => {
    try {
      store.purgeHost(id)
      return ok()
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('trash:empty', () => {
    try {
      store.emptyTrash()
      return ok()
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('hosts:precheck', async (_e, hostId: string) => {
    try {
      const host = store.getHost(hostId)
      if (!host) throw new Error('主机不存在')
      return ok(await precheckHost(host))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('hosts:importSshConfig', async (_e, filePath?: string) => {
    try {
      const path = filePath || defaultSshConfigPath()
      if (!existsSync(path)) throw new Error(`找不到配置文件: ${path}`)
      const parsed = parseSshConfig(readTextFile(path), dirname(path))
      let hosts: HostConfig[] = parsed
        .filter((p) => p.host && p.username)
        .map((p) => ({
          id: randomUUID(),
          name: p.name,
          host: p.host,
          port: p.port,
          username: p.username,
          authType: p.privateKeyPath ? 'privateKey' : 'password',
          privateKeyPath: p.privateKeyPath,
          group: p.group
        }))
      hosts = linkProxyJumps(hosts, parsed)
      store.saveHosts(hosts)
      return ok(redactHosts(hosts))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('settings:get', () => {
    try {
      return ok(store.getSettings())
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('settings:set', (_e, settings: AppSettings) => {
    try {
      return ok(store.setSettings(settings))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('commandHistory:list', (_e, hostId: string) => {
    try {
      return ok(store.listCommandHistory(hostId))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('commandHistory:push', (_e, hostId: string, command: string) => {
    try {
      return ok(store.pushCommandHistory(hostId, command))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('bookmarks:list', (_e, hostId?: string) => {
    try {
      return ok(store.listBookmarks(hostId))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('bookmarks:save', (_e, bookmark: SftpBookmark) => {
    try {
      return ok(store.saveBookmark(bookmark))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('bookmarks:delete', (_e, id: string) => {
    try {
      store.deleteBookmark(id)
      return ok()
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('database:listConnections', (_e, hostId?: string) => {
    try {
      return ok(redactDatabaseConnections(store.listDatabaseConnections(hostId)))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('database:getConnection', (_e, id: string) => {
    try {
      const connection = store.getDatabaseConnection(id)
      if (!connection) throw new Error('数据库连接不存在')
      return ok(connection)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('database:saveConnection', (_e, connection: DatabaseConnectionConfig) => {
    try {
      const existing = store.getDatabaseConnection(connection.id)
      const merged = mergeDatabaseSecrets(connection, existing)
      return ok(redactDatabaseConnection(store.saveDatabaseConnection(merged)))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('database:deleteConnection', (_e, id: string) => {
    try {
      store.deleteDatabaseConnection(id)
      return ok()
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'database:testConnection',
    async (_e, payload: { sshSessionId: string; connection: DatabaseConnectionConfig }) => {
      try {
        const existing = store.getDatabaseConnection(payload.connection.id)
        const merged = mergeDatabaseSecrets(payload.connection, existing)
        await databaseManager.test(payload.sshSessionId, merged)
        return ok()
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('database:detectServices', async (_e, sshSessionId: string) => {
    try {
      return ok(await databaseManager.detectServices(sshSessionId))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'database:connect',
    async (_e, payload: { sshSessionId: string; connectionId: string }) => {
      try {
        const connection = store.getDatabaseConnection(payload.connectionId)
        if (!connection) throw new Error('数据库连接不存在')
        return ok({
          ...(await databaseManager.connect(payload.sshSessionId, connection)),
          connectionId: connection.id,
          sshSessionId: payload.sshSessionId
        })
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('database:disconnect', async (_e, dbSessionId: string) => {
    try {
      await databaseManager.disconnect(dbSessionId)
      return ok()
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('database:assessSql', (_e, payload: { sql: string; readonly?: boolean }) => {
    try {
      return ok(databaseManager.assessSql(payload.sql, payload.readonly))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'database:execute',
    async (
      _e,
      payload: {
        dbSessionId: string
        connectionId: string
        sql: string
        confirmed?: boolean
        saveHistory?: boolean
      }
    ) => {
      try {
        const result = await databaseManager.execute(
          payload.dbSessionId,
          payload.sql,
          !!payload.confirmed
        )
        if (payload.saveHistory !== false) {
          store.pushDatabaseHistory(payload.connectionId, payload.sql)
        }
        return ok(result)
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('database:cancel', async (_e, dbSessionId: string) => {
    try {
      return ok(await databaseManager.cancel(dbSessionId))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'database:exportCsv',
    async (
      _e,
      payload: { columns: string[]; rows: Record<string, unknown>[]; defaultPath?: string }
    ) => {
      try {
        const win = getWindow()
        const opts: Electron.SaveDialogOptions = {
          title: '导出查询结果',
          defaultPath: payload.defaultPath || 'query-result.csv',
          filters: [{ name: 'CSV', extensions: ['csv'] }]
        }
        const result = win
          ? await dialog.showSaveDialog(win, opts)
          : await dialog.showSaveDialog(opts)
        if (result.canceled || !result.filePath) return ok(null)
        writeFileSync(result.filePath, buildCsv(payload.columns, payload.rows), 'utf8')
        return ok(result.filePath)
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('database:listSchemas', async (_e, dbSessionId: string) => {
    try {
      return ok(await databaseManager.listSchemas(dbSessionId))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'database:listTables',
    async (_e, payload: { dbSessionId: string; schema: string }) => {
      try {
        return ok(await databaseManager.listTables(payload.dbSessionId, payload.schema))
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'database:listColumns',
    async (_e, payload: { dbSessionId: string; schema: string; table: string }) => {
      try {
        return ok(
          await databaseManager.listColumns(payload.dbSessionId, payload.schema, payload.table)
        )
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('database:history:list', (_e, connectionId: string) => {
    try {
      return ok(store.listDatabaseHistory(connectionId))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('database:history:push', (_e, connectionId: string, sql: string) => {
    try {
      return ok(store.pushDatabaseHistory(connectionId, sql))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('database:history:delete', (_e, connectionId: string, sql: string) => {
    try {
      return ok(store.deleteDatabaseHistoryItem(connectionId, sql))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('database:history:clear', (_e, connectionId: string) => {
    try {
      return ok(store.clearDatabaseHistory(connectionId))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'session:connect',
    async (_e, payload: { hostId: string; cols?: number; rows?: number }) => {
      try {
        const host = store.getHost(payload.hostId)
        if (!host) throw new Error('主机不存在')
        const settings = store.getSettings()
        const check = await precheckHost(host)
        if (!check.ok) {
          throw new Error(check.messages.filter((m) => m !== '预检通过').join('；') || '预检失败')
        }
        const result = await sessionManager.connect(host, payload.cols, payload.rows, settings)
        store.touchHost(payload.hostId)
        return ok({ ...result, hostId: payload.hostId })
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('session:disconnect', (_e, sessionId: string) => {
    sessionManager.disconnect(sessionId)
    return ok()
  })

  ipcMain.handle('metrics:start', (_e, payload: { sessionId: string; intervalMs?: number }) => {
    try {
      sessionManager.startMetrics(payload.sessionId, payload.intervalMs)
      return ok()
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('metrics:stop', (_e, sessionId: string) => {
    sessionManager.stopMetrics(sessionId)
    return ok()
  })

  ipcMain.handle('vault:export', async () => {
    try {
      if (!store.isInitialized()) throw new Error('保险库不存在')
      const win = getWindow()
      const opts: Electron.SaveDialogOptions = {
        title: '备份数据',
        defaultPath: 'ssh-client-backup.dat',
        filters: [{ name: 'Backup', extensions: ['dat'] }]
      }
      const result = win
        ? await dialog.showSaveDialog(win, opts)
        : await dialog.showSaveDialog(opts)
      if (result.canceled || !result.filePath) return ok(null)
      store.exportTo(result.filePath)
      return ok(result.filePath)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('vault:import', async () => {
    try {
      const win = getWindow()
      const opts: Electron.OpenDialogOptions = {
        title: '从备份恢复',
        properties: ['openFile'],
        filters: [{ name: 'Backup', extensions: ['dat'] }]
      }
      const result = win
        ? await dialog.showOpenDialog(win, opts)
        : await dialog.showOpenDialog(opts)
      if (result.canceled || !result.filePaths[0]) return ok(false)
      store.importFrom(result.filePaths[0])
      return ok(true)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.on('session:write', (_e, payload: { sessionId: string; data: string }) => {
    sessionManager.write(payload.sessionId, payload.data)
  })

  ipcMain.on('session:resize', (_e, payload: { sessionId: string; cols: number; rows: number }) => {
    sessionManager.resize(payload.sessionId, payload.cols, payload.rows)
  })

  ipcMain.handle('sftp:list', async (_e, payload: { sessionId: string; path: string }) => {
    try {
      return ok(await sessionManager.list(payload.sessionId, payload.path))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'sftp:extract',
    async (_e, payload: { sessionId: string; path: string }) => {
      try {
        await sessionManager.extract(payload.sessionId, payload.path)
        return ok()
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'sftp:readText',
    async (_e, payload: { sessionId: string; path: string }) => {
      try {
        return ok(await sessionManager.readTextFile(payload.sessionId, payload.path))
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'sftp:writeText',
    async (_e, payload: { sessionId: string; path: string; content: string }) => {
      try {
        await sessionManager.writeTextFile(payload.sessionId, payload.path, payload.content)
        return ok()
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('sftp:mkdir', async (_e, payload: { sessionId: string; path: string }) => {
    try {
      await sessionManager.mkdir(payload.sessionId, payload.path)
      return ok()
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'sftp:rename',
    async (_e, payload: { sessionId: string; from: string; to: string }) => {
      try {
        await sessionManager.rename(payload.sessionId, payload.from, payload.to)
        return ok()
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'sftp:remove',
    async (_e, payload: { sessionId: string; path: string; isDirectory: boolean }) => {
      try {
        await sessionManager.remove(payload.sessionId, payload.path, payload.isDirectory)
        return ok()
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'sftp:upload',
    async (_e, payload: { sessionId: string; localPath: string; remoteDir: string }) => {
      try {
        return ok(await sessionManager.upload(payload.sessionId, payload.localPath, payload.remoteDir))
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'sftp:download',
    async (_e, payload: { sessionId: string; remotePath: string; localDir: string }) => {
      try {
        return ok(
          await sessionManager.download(payload.sessionId, payload.remotePath, payload.localDir)
        )
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('dialog:openFile', async (_e, options?: { filters?: Electron.FileFilter[] }) => {
    const win = getWindow()
    const opts: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: options?.filters
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return ok(result.canceled ? null : result.filePaths[0] ?? null)
  })

  ipcMain.handle('dialog:openFiles', async () => {
    const win = getWindow()
    const opts: Electron.OpenDialogOptions = {
      properties: ['openFile', 'multiSelections']
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return ok(result.canceled ? [] : result.filePaths)
  })

  ipcMain.handle('dialog:openDirectory', async () => {
    const win = getWindow()
    const opts: Electron.OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory']
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return ok(result.canceled ? null : result.filePaths[0] ?? null)
  })
}
