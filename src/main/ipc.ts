import { BrowserWindow, dialog, ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import {
  AppSettings,
  HostConfig,
  SftpBookmark,
  Snippet
} from '../shared/types'
import { store } from './store/encrypted-store'
import { sessionManager } from './session-manager'
import {
  defaultSshConfigPath,
  parseCsvHosts,
  parseSshConfig,
  precheckHost,
  readTextFile
} from './host-utils'

function ok<T>(data: T): { ok: true; data: T }
function ok(): { ok: true }
function ok<T>(data?: T) {
  return data === undefined ? { ok: true as const } : { ok: true as const, data }
}

function fail(error: unknown): { ok: false; error: string } {
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, error: message }
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
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
    sessionManager.disconnectAll()
    store.lock()
    return ok()
  })

  ipcMain.handle('vault:reset', () => {
    try {
      sessionManager.disconnectAll()
      store.reset()
      return ok()
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('hosts:list', () => {
    try {
      return ok(store.listHosts())
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('hosts:save', (_e, host: HostConfig) => {
    try {
      return ok(store.saveHost(host))
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
      return ok(store.listTrashHosts())
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('trash:restore', (_e, id: string) => {
    try {
      return ok(store.restoreHost(id))
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
      const parsed = parseSshConfig(readTextFile(path))
      const hosts: HostConfig[] = parsed
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
      store.saveHosts(hosts)
      return ok(hosts)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('hosts:importCsv', async (_e, filePath: string) => {
    try {
      const parsed = parseCsvHosts(readTextFile(filePath))
      const hosts: HostConfig[] = parsed
        .filter((p) => p.host)
        .map((p) => ({
          id: randomUUID(),
          name: p.name,
          host: p.host,
          port: Number(p.port) || 22,
          username: p.username || '',
          authType: p.authType || 'password',
          password: p.password,
          privateKeyPath: p.privateKeyPath,
          group: p.group || 'csv'
        }))
      store.saveHosts(hosts)
      return ok(hosts)
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

  ipcMain.handle('snippets:list', () => {
    try {
      return ok(store.listSnippets())
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('snippets:save', (_e, snippet: Snippet) => {
    try {
      return ok(store.saveSnippet(snippet))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('snippets:delete', (_e, id: string) => {
    try {
      store.deleteSnippet(id)
      return ok()
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
