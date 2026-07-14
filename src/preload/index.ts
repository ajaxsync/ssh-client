import { contextBridge, clipboard, ipcRenderer, IpcRendererEvent } from 'electron'
import type {
  AppSettings,
  HostConfig,
  HostMetrics,
  PrecheckResult,
  SessionInfo,
  SftpBookmark,
  SftpListResult,
  Snippet,
  TransferProgress,
  TrashHostItem,
  VaultStatus
} from '../shared/types'

type Result<T = void> = { ok: true; data: T } | { ok: false; error: string }

const api = {
  vault: {
    status: (): Promise<Result<VaultStatus>> => ipcRenderer.invoke('vault:status'),
    setup: (password: string): Promise<Result> => ipcRenderer.invoke('vault:setup', password),
    setupOs: (): Promise<Result> => ipcRenderer.invoke('vault:setupOs'),
    unlock: (password: string): Promise<Result> => ipcRenderer.invoke('vault:unlock', password),
    unlockOs: (): Promise<Result> => ipcRenderer.invoke('vault:unlockOs'),
    tryAutoUnlock: (): Promise<Result<VaultStatus>> => ipcRenderer.invoke('vault:tryAutoUnlock'),
    lock: (): Promise<Result> => ipcRenderer.invoke('vault:lock'),
    reset: (): Promise<Result> => ipcRenderer.invoke('vault:reset')
  },
  hosts: {
    list: (): Promise<Result<HostConfig[]>> => ipcRenderer.invoke('hosts:list'),
    save: (host: HostConfig): Promise<Result<HostConfig>> => ipcRenderer.invoke('hosts:save', host),
    delete: (id: string): Promise<Result> => ipcRenderer.invoke('hosts:delete', id),
    precheck: (hostId: string): Promise<Result<PrecheckResult>> =>
      ipcRenderer.invoke('hosts:precheck', hostId),
    importSshConfig: (filePath?: string): Promise<Result<HostConfig[]>> =>
      ipcRenderer.invoke('hosts:importSshConfig', filePath),
    importCsv: (filePath: string): Promise<Result<HostConfig[]>> =>
      ipcRenderer.invoke('hosts:importCsv', filePath)
  },
  trash: {
    list: (): Promise<Result<TrashHostItem[]>> => ipcRenderer.invoke('trash:list'),
    restore: (id: string): Promise<Result<HostConfig>> => ipcRenderer.invoke('trash:restore', id),
    purge: (id: string): Promise<Result> => ipcRenderer.invoke('trash:purge', id),
    empty: (): Promise<Result> => ipcRenderer.invoke('trash:empty')
  },
  settings: {
    get: (): Promise<Result<AppSettings>> => ipcRenderer.invoke('settings:get'),
    set: (settings: AppSettings): Promise<Result<AppSettings>> =>
      ipcRenderer.invoke('settings:set', settings)
  },
  snippets: {
    list: (): Promise<Result<Snippet[]>> => ipcRenderer.invoke('snippets:list'),
    save: (snippet: Snippet): Promise<Result<Snippet>> =>
      ipcRenderer.invoke('snippets:save', snippet),
    delete: (id: string): Promise<Result> => ipcRenderer.invoke('snippets:delete', id)
  },
  bookmarks: {
    list: (hostId?: string): Promise<Result<SftpBookmark[]>> =>
      ipcRenderer.invoke('bookmarks:list', hostId),
    save: (bookmark: SftpBookmark): Promise<Result<SftpBookmark>> =>
      ipcRenderer.invoke('bookmarks:save', bookmark),
    delete: (id: string): Promise<Result> => ipcRenderer.invoke('bookmarks:delete', id)
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
