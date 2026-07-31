import { contextBridge, clipboard, ipcRenderer, IpcRendererEvent } from 'electron'
import type {
  AppSettings,
  DatabaseColumnInfo,
  DatabaseConnectionConfig,
  DatabaseConnectionPublic,
  DatabaseDetectedService,
  DatabaseQueryResult,
  DatabaseSchemaInfo,
  DatabaseSessionInfo,
  DatabaseSqlRisk,
  DatabaseTableInfo,
  HostConfig,
  HostMetrics,
  HostPublic,
  PrecheckResult,
  SessionInfo,
  SftpBookmark,
  SftpListResult,
  TransferProgress,
  TrashHostPublic,
  VaultStatus
} from '../shared/types'

type Result<T = void> = { ok: true; data: T } | { ok: false; error: string }

const api = {
  app: {
    getVersion: (): Promise<Result<string>> => ipcRenderer.invoke('app:version'),
    checkUpdate: (): Promise<
      Result<{
        current: string
        latest: string
        url: string
        updateAvailable: boolean
      }>
    > => ipcRenderer.invoke('app:checkUpdate')
  },
  shell: {
    openExternal: (url: string): Promise<Result> =>
      ipcRenderer.invoke('shell:openExternal', url)
  },
  vault: {
    status: (): Promise<Result<VaultStatus>> => ipcRenderer.invoke('vault:status'),
    setup: (password: string): Promise<Result> => ipcRenderer.invoke('vault:setup', password),
    setupOs: (): Promise<Result> => ipcRenderer.invoke('vault:setupOs'),
    unlock: (password: string): Promise<Result> => ipcRenderer.invoke('vault:unlock', password),
    unlockOs: (): Promise<Result> => ipcRenderer.invoke('vault:unlockOs'),
    tryAutoUnlock: (): Promise<Result<VaultStatus>> => ipcRenderer.invoke('vault:tryAutoUnlock'),
    lock: (): Promise<Result> => ipcRenderer.invoke('vault:lock'),
    reset: (): Promise<Result> => ipcRenderer.invoke('vault:reset'),
    exportBackup: (): Promise<Result<string | null>> => ipcRenderer.invoke('vault:export'),
    importBackup: (): Promise<Result<boolean>> => ipcRenderer.invoke('vault:import')
  },
  hosts: {
    list: (): Promise<Result<HostPublic[]>> => ipcRenderer.invoke('hosts:list'),
    get: (id: string): Promise<Result<HostConfig>> => ipcRenderer.invoke('hosts:get', id),
    save: (host: HostConfig): Promise<Result<HostPublic>> => ipcRenderer.invoke('hosts:save', host),
    delete: (id: string): Promise<Result> => ipcRenderer.invoke('hosts:delete', id),
    precheck: (hostId: string): Promise<Result<PrecheckResult>> =>
      ipcRenderer.invoke('hosts:precheck', hostId),
    importSshConfig: (filePath?: string): Promise<Result<HostPublic[]>> =>
      ipcRenderer.invoke('hosts:importSshConfig', filePath)
  },
  trash: {
    list: (): Promise<Result<TrashHostPublic[]>> => ipcRenderer.invoke('trash:list'),
    restore: (id: string): Promise<Result<HostPublic>> => ipcRenderer.invoke('trash:restore', id),
    purge: (id: string): Promise<Result> => ipcRenderer.invoke('trash:purge', id),
    empty: (): Promise<Result> => ipcRenderer.invoke('trash:empty')
  },
  settings: {
    get: (): Promise<Result<AppSettings>> => ipcRenderer.invoke('settings:get'),
    set: (settings: AppSettings): Promise<Result<AppSettings>> =>
      ipcRenderer.invoke('settings:set', settings)
  },
  commandHistory: {
    list: (hostId: string): Promise<Result<string[]>> =>
      ipcRenderer.invoke('commandHistory:list', hostId),
    push: (hostId: string, command: string): Promise<Result<string[]>> =>
      ipcRenderer.invoke('commandHistory:push', hostId, command)
  },
  bookmarks: {
    list: (hostId?: string): Promise<Result<SftpBookmark[]>> =>
      ipcRenderer.invoke('bookmarks:list', hostId),
    save: (bookmark: SftpBookmark): Promise<Result<SftpBookmark>> =>
      ipcRenderer.invoke('bookmarks:save', bookmark),
    delete: (id: string): Promise<Result> => ipcRenderer.invoke('bookmarks:delete', id)
  },
  database: {
    listConnections: (hostId?: string): Promise<Result<DatabaseConnectionPublic[]>> =>
      ipcRenderer.invoke('database:listConnections', hostId),
    getConnection: (id: string): Promise<Result<DatabaseConnectionConfig>> =>
      ipcRenderer.invoke('database:getConnection', id),
    saveConnection: (
      connection: DatabaseConnectionConfig
    ): Promise<Result<DatabaseConnectionPublic>> =>
      ipcRenderer.invoke('database:saveConnection', connection),
    deleteConnection: (id: string): Promise<Result> =>
      ipcRenderer.invoke('database:deleteConnection', id),
    testConnection: (
      sshSessionId: string,
      connection: DatabaseConnectionConfig
    ): Promise<Result> =>
      ipcRenderer.invoke('database:testConnection', { sshSessionId, connection }),
    detectServices: (sshSessionId: string): Promise<Result<DatabaseDetectedService[]>> =>
      ipcRenderer.invoke('database:detectServices', sshSessionId),
    connect: (
      sshSessionId: string,
      connectionId: string
    ): Promise<Result<DatabaseSessionInfo>> =>
      ipcRenderer.invoke('database:connect', { sshSessionId, connectionId }),
    disconnect: (dbSessionId: string): Promise<Result> =>
      ipcRenderer.invoke('database:disconnect', dbSessionId),
    assessSql: (sql: string, readonly?: boolean): Promise<Result<DatabaseSqlRisk>> =>
      ipcRenderer.invoke('database:assessSql', { sql, readonly }),
    execute: (
      dbSessionId: string,
      connectionId: string,
      sql: string,
      confirmed?: boolean,
      saveHistory?: boolean
    ): Promise<Result<DatabaseQueryResult>> =>
      ipcRenderer.invoke('database:execute', {
        dbSessionId,
        connectionId,
        sql,
        confirmed,
        saveHistory
      }),
    cancel: (
      dbSessionId: string
    ): Promise<Result<{ requested: boolean; message: string }>> =>
      ipcRenderer.invoke('database:cancel', dbSessionId),
    exportCsv: (
      columns: string[],
      rows: Record<string, unknown>[],
      defaultPath?: string
    ): Promise<Result<string | null>> =>
      ipcRenderer.invoke('database:exportCsv', { columns, rows, defaultPath }),
    listSchemas: (dbSessionId: string): Promise<Result<DatabaseSchemaInfo[]>> =>
      ipcRenderer.invoke('database:listSchemas', dbSessionId),
    listTables: (dbSessionId: string, schema: string): Promise<Result<DatabaseTableInfo[]>> =>
      ipcRenderer.invoke('database:listTables', { dbSessionId, schema }),
    listColumns: (
      dbSessionId: string,
      schema: string,
      table: string
    ): Promise<Result<DatabaseColumnInfo[]>> =>
      ipcRenderer.invoke('database:listColumns', { dbSessionId, schema, table }),
    listHistory: (connectionId: string): Promise<Result<string[]>> =>
      ipcRenderer.invoke('database:history:list', connectionId),
    pushHistory: (connectionId: string, sql: string): Promise<Result<string[]>> =>
      ipcRenderer.invoke('database:history:push', connectionId, sql),
    deleteHistory: (connectionId: string, sql: string): Promise<Result<string[]>> =>
      ipcRenderer.invoke('database:history:delete', connectionId, sql),
    clearHistory: (connectionId: string): Promise<Result<string[]>> =>
      ipcRenderer.invoke('database:history:clear', connectionId)
  },
  session: {
    connect: (payload: {
      hostId: string
      cols?: number
      rows?: number
    }): Promise<Result<SessionInfo>> => ipcRenderer.invoke('session:connect', payload),
    disconnect: (sessionId: string): Promise<Result> =>
      ipcRenderer.invoke('session:disconnect', sessionId),
    write: (sessionId: string, data: string): void =>
      ipcRenderer.send('session:write', { sessionId, data }),
    resize: (sessionId: string, cols: number, rows: number): void =>
      ipcRenderer.send('session:resize', { sessionId, cols, rows }),
    onData: (cb: (payload: { sessionId: string; data: string }) => void): (() => void) => {
      const listener = (_: IpcRendererEvent, payload: { sessionId: string; data: string }): void =>
        cb(payload)
      ipcRenderer.on('session:data', listener)
      return () => ipcRenderer.removeListener('session:data', listener)
    },
    onClosed: (cb: (payload: { sessionId: string }) => void): (() => void) => {
      const listener = (_: IpcRendererEvent, payload: { sessionId: string }): void => cb(payload)
      ipcRenderer.on('session:closed', listener)
      return () => ipcRenderer.removeListener('session:closed', listener)
    },
    onError: (cb: (payload: { sessionId: string; message: string }) => void): (() => void) => {
      const listener = (
        _: IpcRendererEvent,
        payload: { sessionId: string; message: string }
      ): void => cb(payload)
      ipcRenderer.on('session:error', listener)
      return () => ipcRenderer.removeListener('session:error', listener)
    }
  },
  metrics: {
    start: (sessionId: string, intervalMs?: number): Promise<Result> =>
      ipcRenderer.invoke('metrics:start', { sessionId, intervalMs }),
    stop: (sessionId: string): Promise<Result> => ipcRenderer.invoke('metrics:stop', sessionId),
    onData: (cb: (payload: HostMetrics) => void): (() => void) => {
      const listener = (_: IpcRendererEvent, payload: HostMetrics): void => cb(payload)
      ipcRenderer.on('metrics:data', listener)
      return () => ipcRenderer.removeListener('metrics:data', listener)
    }
  },
  sftp: {
    list: (sessionId: string, path: string): Promise<Result<SftpListResult>> =>
      ipcRenderer.invoke('sftp:list', { sessionId, path }),
    mkdir: (sessionId: string, path: string): Promise<Result> =>
      ipcRenderer.invoke('sftp:mkdir', { sessionId, path }),
    rename: (sessionId: string, from: string, to: string): Promise<Result> =>
      ipcRenderer.invoke('sftp:rename', { sessionId, from, to }),
    remove: (sessionId: string, path: string, isDirectory: boolean): Promise<Result> =>
      ipcRenderer.invoke('sftp:remove', { sessionId, path, isDirectory }),
    upload: (sessionId: string, localPath: string, remoteDir: string): Promise<Result<string>> =>
      ipcRenderer.invoke('sftp:upload', { sessionId, localPath, remoteDir }),
    download: (sessionId: string, remotePath: string, localDir: string): Promise<Result<string>> =>
      ipcRenderer.invoke('sftp:download', { sessionId, remotePath, localDir }),
    extract: (sessionId: string, remotePath: string): Promise<Result> =>
      ipcRenderer.invoke('sftp:extract', { sessionId, path: remotePath }),
    readText: (
      sessionId: string,
      remotePath: string
    ): Promise<Result<{ content: string; truncated: boolean; size: number }>> =>
      ipcRenderer.invoke('sftp:readText', { sessionId, path: remotePath }),
    writeText: (sessionId: string, remotePath: string, content: string): Promise<Result> =>
      ipcRenderer.invoke('sftp:writeText', { sessionId, path: remotePath, content }),
    onProgress: (cb: (payload: TransferProgress) => void): (() => void) => {
      const listener = (_: IpcRendererEvent, payload: TransferProgress): void => cb(payload)
      ipcRenderer.on('sftp:progress', listener)
      return () => ipcRenderer.removeListener('sftp:progress', listener)
    }
  },
  dialog: {
    openFile: (filters?: Electron.FileFilter[]): Promise<Result<string | null>> =>
      ipcRenderer.invoke('dialog:openFile', { filters }),
    openFiles: (): Promise<Result<string[]>> => ipcRenderer.invoke('dialog:openFiles'),
    openDirectory: (): Promise<Result<string | null>> => ipcRenderer.invoke('dialog:openDirectory')
  },
  clipboard: {
    readText: (): string => clipboard.readText(),
    writeText: (text: string): void => {
      clipboard.writeText(text || '')
    }
  }
}

contextBridge.exposeInMainWorld('api', api)

export type SshApi = typeof api
