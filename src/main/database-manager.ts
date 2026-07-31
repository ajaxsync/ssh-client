import { randomUUID } from 'crypto'
import type { Duplex } from 'stream'
import mysql from 'mysql2/promise'
import type { Connection as MysqlConnection, FieldPacket } from 'mysql2/promise'
import { Client as PgClient } from 'pg'
import type {
  DatabaseConnectionConfig,
  DatabaseDetectedService,
  DatabaseQueryResult,
  DatabaseSqlRisk
} from '../shared/types'
import { sessionManager } from './session-manager'

type DatabaseClient =
  | {
      driver: 'mysql'
      client: MysqlConnection
      stream: Duplex
    }
  | {
      driver: 'postgres'
      client: PgClient
      stream: Duplex
    }

interface ActiveDatabaseSession {
  id: string
  sshSessionId: string
  connectionId: string
  name: string
  config: DatabaseConnectionConfig
  readonly: boolean
  db: DatabaseClient
  executing: boolean
}

export class DatabaseManager {
  private sessions = new Map<string, ActiveDatabaseSession>()

  constructor() {
    sessionManager.onCleanup((sshSessionId) => this.disconnectBySshSession(sshSessionId))
  }

  async detectServices(sshSessionId: string): Promise<DatabaseDetectedService[]> {
    const output = await sessionManager.exec(sshSessionId, DETECT_DATABASE_SERVICES_COMMAND)
    return parseDetectedServices(output)
  }

  assessSql(sql: string, readonly = false): DatabaseSqlRisk {
    const statements = splitStatements(stripSqlComments(sql))
    const reasons: string[] = []
    if (!statements.length) {
      return { level: 'safe', readonlyBlocked: false, reasons: [] }
    }
    if (statements.length > 1) reasons.push('包含多条 SQL 语句')

    let level: DatabaseSqlRisk['level'] = 'safe'
    for (const statement of statements) {
      const normalized = statement.trim().replace(/\s+/g, ' ')
      const head = normalized.split(/\s+/, 1)[0]?.toLowerCase() || ''
      if (['select', 'show', 'describe', 'desc', 'explain'].includes(head)) continue

      if (['insert', 'replace'].includes(head)) {
        level = maxRisk(level, 'write')
        reasons.push(`${head.toUpperCase()} 会修改数据`)
        continue
      }

      if (head === 'update' || head === 'delete') {
        level = maxRisk(level, /\bwhere\b/i.test(normalized) ? 'write' : 'danger')
        reasons.push(
          /\bwhere\b/i.test(normalized)
            ? `${head.toUpperCase()} 会修改数据`
            : `${head.toUpperCase()} 没有 WHERE 条件`
        )
        continue
      }

      if (
        [
          'drop',
          'truncate',
          'alter',
          'create',
          'grant',
          'revoke',
          'rename',
          'call',
          'do',
          'merge'
        ].includes(head)
      ) {
        level = maxRisk(level, 'danger')
        reasons.push(`${head.toUpperCase()} 属于高风险语句`)
        continue
      }

      level = maxRisk(level, 'danger')
      reasons.push(`无法确认 ${head ? head.toUpperCase() : '该'} 语句是否只读`)
    }

    return {
      level,
      readonlyBlocked: readonly && level !== 'safe',
      reasons: [...new Set(reasons)]
    }
  }

  async test(sshSessionId: string, config: DatabaseConnectionConfig): Promise<void> {
    const session = await this.connect(sshSessionId, config)
    await this.disconnect(session.dbSessionId)
  }

  async connect(
    sshSessionId: string,
    config: DatabaseConnectionConfig
  ): Promise<{
    dbSessionId: string
    name: string
    driver: DatabaseConnectionConfig['driver']
    database?: string
  }> {
    let stream: Duplex | null = null
    try {
      stream = await sessionManager.openForwardStream(sshSessionId, config.dbHost, config.dbPort)
      const db = await this.openDatabaseClient(config, stream)
      const id = randomUUID()
      this.sessions.set(id, {
        id,
        sshSessionId,
        connectionId: config.id,
        name: config.name,
        config,
        readonly: !!config.readonly,
        db,
        executing: false
      })
      return { dbSessionId: id, name: config.name, driver: config.driver, database: config.database }
    } catch (error) {
      stream?.destroy()
      throw new Error(friendlyDatabaseConnectError(error))
    }
  }

  async disconnect(dbSessionId: string): Promise<void> {
    const session = this.sessions.get(dbSessionId)
    if (!session) return
    this.sessions.delete(dbSessionId)
    await this.closeDatabaseClient(session.db)
  }

  disconnectBySshSession(sshSessionId: string): void {
    for (const session of [...this.sessions.values()]) {
      if (session.sshSessionId === sshSessionId) {
        void this.disconnect(session.id)
      }
    }
  }

  disconnectAll(): void {
    for (const id of [...this.sessions.keys()]) {
      void this.disconnect(id)
    }
  }

  async execute(dbSessionId: string, sql: string, confirmed = false): Promise<DatabaseQueryResult> {
    const session = this.requireSession(dbSessionId)
    const risk = this.assessSql(sql, session.readonly)
    if (risk.readonlyBlocked) {
      throw new Error('该连接为只读连接，禁止执行写入或结构变更语句')
    }
    if (risk.level !== 'safe' && !confirmed) {
      throw new Error(`需要确认后执行：${risk.reasons.join('；') || '该 SQL 可能修改数据'}`)
    }

    const started = performance.now()
    session.executing = true
    try {
      return await this.runWithReconnect(session, risk.level === 'safe', async () => {
        if (session.db.driver === 'mysql') {
          const [rows, fields] = await session.db.client.query(sql)
          return normalizeMysqlResult(rows, fields, performance.now() - started)
        }

        const result = await session.db.client.query(sql)
        return {
          columns: result.fields.map((f) => f.name),
          rows: result.rows.map(normalizeRow),
          rowCount: result.rows.length,
          affectedRows: result.rowCount ?? undefined,
          command: result.command,
          elapsedMs: Math.round(performance.now() - started)
        }
      })
    } finally {
      session.executing = false
    }
  }

  async cancel(dbSessionId: string): Promise<{ requested: boolean; message: string }> {
    const session = this.requireSession(dbSessionId)
    if (!session.executing) return { requested: false, message: '当前没有正在执行的查询' }

    if (session.db.driver === 'mysql') {
      const threadId = mysqlThreadId(session.db.client)
      if (!threadId) throw new Error('无法获取 MySQL 查询线程 ID，不能取消当前查询')
      await this.runWithTemporaryClient(session, async (db) => {
        if (db.driver !== 'mysql') throw new Error('数据库类型不匹配')
        await db.client.query(`KILL QUERY ${threadId}`)
      })
      return { requested: true, message: '已向 MySQL 发送取消查询请求' }
    }

    const processId = (session.db.client as unknown as { processID?: number }).processID
    if (!processId) throw new Error('无法获取 PostgreSQL 后端进程 ID，不能取消当前查询')
    let cancelled = false
    await this.runWithTemporaryClient(session, async (db) => {
      if (db.driver !== 'postgres') throw new Error('数据库类型不匹配')
      const result = await db.client.query('select pg_cancel_backend($1) as cancelled', [processId])
      cancelled = result.rows.some((row) => row.cancelled === true)
    })
    return {
      requested: cancelled,
      message: cancelled ? '已向 PostgreSQL 发送取消查询请求' : 'PostgreSQL 未接受取消请求'
    }
  }

  async listSchemas(dbSessionId: string): Promise<{ name: string }[]> {
    const session = this.requireSession(dbSessionId)
    return this.runWithReconnect(session, true, async () => {
      if (session.db.driver === 'mysql') {
        const [rows] = await session.db.client.query('SHOW DATABASES')
        return asRows(rows)
          .map((row) => String(Object.values(row)[0] ?? ''))
          .filter(Boolean)
          .map((name) => ({ name }))
      }

      const result = await session.db.client.query(`
        select schema_name as name
        from information_schema.schemata
        where schema_name not in ('pg_catalog', 'information_schema')
        order by schema_name
      `)
      return result.rows.map((row) => ({ name: String(row.name) }))
    })
  }

  async listTables(
    dbSessionId: string,
    schema: string
  ): Promise<{ schema: string; name: string; type: 'table' | 'view' }[]> {
    const session = this.requireSession(dbSessionId)
    return this.runWithReconnect(session, true, async () => {
      if (session.db.driver === 'mysql') {
        const [rows] = await session.db.client.query(
          `
            select table_schema as schemaName, table_name as name, table_type as typeName
            from information_schema.tables
            where table_schema = ?
            order by table_name
          `,
          [schema]
        )
        return asRows(rows).map((row) => ({
          schema: String(row.schemaName),
          name: String(row.name),
          type: String(row.typeName).toLowerCase().includes('view') ? 'view' : 'table'
        }))
      }

      const result = await session.db.client.query(
        `
          select table_schema as schema, table_name as name, table_type as type
          from information_schema.tables
          where table_schema = $1
          order by table_name
        `,
        [schema]
      )
      return result.rows.map((row) => ({
        schema: String(row.schema),
        name: String(row.name),
        type: String(row.type).toLowerCase().includes('view') ? 'view' : 'table'
      }))
    })
  }

  async listColumns(
    dbSessionId: string,
    schema: string,
    table: string
  ): Promise<{ name: string; type: string; nullable: boolean; defaultValue?: string; ordinal: number }[]> {
    const session = this.requireSession(dbSessionId)
    return this.runWithReconnect(session, true, async () => {
      if (session.db.driver === 'mysql') {
        const [rows] = await session.db.client.query(
          `
            select column_name as name, column_type as typeName, is_nullable as nullable,
              column_default as defaultValue, ordinal_position as ordinal
            from information_schema.columns
            where table_schema = ? and table_name = ?
            order by ordinal_position
          `,
          [schema, table]
        )
        return asRows(rows).map(normalizeColumnRow)
      }

      const result = await session.db.client.query(
        `
          select column_name as name, data_type as "typeName", is_nullable as nullable,
            column_default as "defaultValue", ordinal_position as ordinal
          from information_schema.columns
          where table_schema = $1 and table_name = $2
          order by ordinal_position
        `,
        [schema, table]
      )
      return result.rows.map(normalizeColumnRow)
    })
  }

  private async openDatabaseClient(
    config: DatabaseConnectionConfig,
    stream: Duplex
  ): Promise<DatabaseClient> {
    if (config.driver === 'mysql') {
      const client = await mysql.createConnection({
        stream,
        user: config.username,
        password: config.password || undefined,
        database: config.database || undefined,
        ssl: config.ssl ? {} : undefined,
        connectTimeout: 15000,
        multipleStatements: false
      })
      return { driver: 'mysql', client, stream }
    }

    const client = new PgClient({
      stream: () => stream,
      user: config.username,
      password: config.password || undefined,
      database: config.database || undefined,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: 15000
    })
    await client.connect()
    return { driver: 'postgres', client, stream }
  }

  private async closeDatabaseClient(db: DatabaseClient): Promise<void> {
    try {
      if (db.driver === 'mysql') await db.client.end()
      else await db.client.end()
    } catch {
      /* ignore */
    }
    try {
      db.stream.destroy()
    } catch {
      /* ignore */
    }
  }

  private async runWithTemporaryClient(
    session: ActiveDatabaseSession,
    fn: (db: DatabaseClient) => Promise<void>
  ): Promise<void> {
    const stream = await sessionManager.openForwardStream(
      session.sshSessionId,
      session.config.dbHost,
      session.config.dbPort
    )
    let db: DatabaseClient | null = null
    try {
      db = await this.openDatabaseClient(session.config, stream)
      await fn(db)
    } catch (error) {
      stream.destroy()
      throw error
    } finally {
      if (db) await this.closeDatabaseClient(db)
    }
  }

  private async runWithReconnect<T>(
    session: ActiveDatabaseSession,
    retry: boolean,
    fn: () => Promise<T>
  ): Promise<T> {
    try {
      return await fn()
    } catch (error) {
      if (!isReconnectableDatabaseError(error)) throw error
      await this.reconnectSession(session)
      if (!retry) {
        throw new Error('数据库连接已自动重连。为避免重复写入，请确认后重新执行该 SQL')
      }
      return await fn()
    }
  }

  private async reconnectSession(session: ActiveDatabaseSession): Promise<void> {
    await this.closeDatabaseClient(session.db)
    let stream: Duplex | null = null
    try {
      stream = await sessionManager.openForwardStream(
        session.sshSessionId,
        session.config.dbHost,
        session.config.dbPort
      )
      session.db = await this.openDatabaseClient(session.config, stream)
    } catch (error) {
      stream?.destroy()
      throw new Error(`数据库连接已断开，自动重连失败：${friendlyDatabaseConnectError(error)}`)
    }
  }

  private requireSession(dbSessionId: string): ActiveDatabaseSession {
    const session = this.sessions.get(dbSessionId)
    if (!session) throw new Error('数据库连接不存在或已关闭')
    return session
  }
}

function maxRisk(
  current: DatabaseSqlRisk['level'],
  next: DatabaseSqlRisk['level']
): DatabaseSqlRisk['level'] {
  const order = { safe: 0, write: 1, danger: 2 }
  return order[next] > order[current] ? next : current
}

function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ')
    .replace(/#.*$/gm, ' ')
}

function splitStatements(sql: string): string[] {
  return sql
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean)
}

function normalizeMysqlResult(
  rows: unknown,
  fields: FieldPacket[] | FieldPacket[][] | undefined,
  elapsedMs: number
): DatabaseQueryResult {
  if (Array.isArray(rows)) {
    const plainRows = rows.map((row) => normalizeRow(row as Record<string, unknown>))
    const columns = Array.isArray(fields)
      ? (fields as FieldPacket[]).filter((f) => 'name' in f).map((f) => f.name)
      : Object.keys(plainRows[0] ?? {})
    return {
      columns,
      rows: plainRows,
      rowCount: plainRows.length,
      elapsedMs: Math.round(elapsedMs)
    }
  }

  const packet = rows as { affectedRows?: number; changedRows?: number; warningStatus?: number }
  return {
    columns: [],
    rows: [],
    rowCount: 0,
    affectedRows: packet.affectedRows ?? packet.changedRows ?? 0,
    elapsedMs: Math.round(elapsedMs)
  }
}

function asRows(rows: unknown): Record<string, unknown>[] {
  return Array.isArray(rows) ? rows.map((row) => row as Record<string, unknown>) : []
}

function normalizeColumnRow(row: Record<string, unknown>): {
  name: string
  type: string
  nullable: boolean
  defaultValue?: string
  ordinal: number
} {
  return {
    name: String(row.name ?? ''),
    type: String(row.typeName ?? row.type ?? ''),
    nullable: String(row.nullable ?? '').toUpperCase() === 'YES',
    defaultValue: row.defaultValue === null || row.defaultValue === undefined ? undefined : String(row.defaultValue),
    ordinal: Number(row.ordinal) || 0
  }
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    out[key] = normalizeValue(value)
  }
  return out
}

function normalizeValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (Buffer.isBuffer(value)) return `0x${value.toString('hex')}`
  if (typeof value === 'bigint') return value.toString()
  return value
}

function mysqlThreadId(client: MysqlConnection): number | null {
  const direct = (client as unknown as { threadId?: unknown }).threadId
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct
  const nested = (client as unknown as { connection?: { threadId?: unknown } }).connection?.threadId
  if (typeof nested === 'number' && Number.isFinite(nested)) return nested
  return null
}

function isReconnectableDatabaseError(error: unknown): boolean {
  const err = error as { code?: unknown; fatal?: unknown; message?: unknown }
  const code = typeof err.code === 'string' ? err.code.toUpperCase() : ''
  const message = String(err.message ?? error).toLowerCase()
  return (
    code === 'PROTOCOL_CONNECTION_LOST' ||
    code === 'ECONNRESET' ||
    code === 'EPIPE' ||
    code === 'CONNECTION_CLOSED' ||
    message.includes('connection is in closed state') ||
    message.includes('connection is closed') ||
    message.includes('connection terminated') ||
    message.includes('client was closed') ||
    message.includes('cannot enqueue query after fatal error') ||
    message.includes('server closed the connection')
  )
}

function friendlyDatabaseConnectError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const message = raw.toLowerCase()

  if (message.includes('access denied') || message.includes('password authentication failed')) {
    return '数据库用户名或密码错误，或该用户没有连接权限'
  }
  if (message.includes('database') && message.includes('does not exist')) {
    return '默认数据库不存在，请检查“默认数据库”名称；PostgreSQL 可先填写 postgres'
  }
  if (message.includes('no pg_hba.conf entry')) {
    return 'PostgreSQL 拒绝连接，可能是 pg_hba.conf 未允许该用户或来源'
  }
  if (
    message.includes('econnrefused') ||
    message.includes('connection refused') ||
    message.includes('connect refused')
  ) {
    return '数据库端口未监听或服务未启动，请检查服务和端口状态'
  }
  if (
    message.includes('etimedout') ||
    message.includes('timeout') ||
    message.includes('timed out')
  ) {
    return '数据库连接超时，请检查服务、端口、防火墙或 SSH 转发链路'
  }
  if (message.includes('too many connections')) {
    return '数据库连接数已满，请稍后重试或释放空闲连接'
  }
  if (message.includes('ssl')) {
    return '数据库 SSL 配置不匹配，请检查是否需要开启或关闭 SSL'
  }

  return raw.replace(/password=[^;\s]+/gi, 'password=***')
}

export const databaseManager = new DatabaseManager()

const DETECT_DATABASE_SERVICES_COMMAND = `
sh -lc '
emit_port() {
  port="$1"
  driver="$2"
  label="$3"
  lines="$(ss -lnt 2>/dev/null || netstat -lnt 2>/dev/null)"
  detail="$(printf "%s\\n" "$lines" | awk "{print \\$4}" | grep -E "(:|\\.)\${port}$" | paste -sd "," - | cut -c1-180)"
  if [ -n "$detail" ]; then
    echo "\${driver}|127.0.0.1|\${port}|\${label}|port|\${detail}"
  fi
}
mysql_detail() {
  if command -v mysqld >/dev/null 2>&1; then mysqld --version 2>/dev/null | head -n1; return 0; fi
  if command -v mariadbd >/dev/null 2>&1; then mariadbd --version 2>/dev/null | head -n1; return 0; fi
  if [ -x /usr/sbin/mysqld ]; then /usr/sbin/mysqld --version 2>/dev/null | head -n1; return 0; fi
  if [ -x /usr/sbin/mariadbd ]; then /usr/sbin/mariadbd --version 2>/dev/null | head -n1; return 0; fi
  unit="$(systemctl list-unit-files --type=service --no-legend 2>/dev/null | awk "{print \\$1}" | grep -E "^(mysql|mysqld|mariadb)\\.service$" | head -n1)"
  if [ -n "$unit" ]; then echo "systemd: $unit"; return 0; fi
  pkg="$(dpkg -l 2>/dev/null | awk "{print \\$2}" | grep -E "^(mysql-server|mariadb-server)(-[0-9.]+)?$" | head -n1)"
  if [ -n "$pkg" ]; then echo "package: $pkg"; return 0; fi
  pkg="$(rpm -qa 2>/dev/null | grep -E "^(mysql-server|mariadb-server)-" | head -n1)"
  if [ -n "$pkg" ]; then echo "package: $pkg"; return 0; fi
  return 1
}
postgres_detail() {
  if command -v postgres >/dev/null 2>&1; then postgres --version 2>/dev/null | head -n1; return 0; fi
  if command -v postmaster >/dev/null 2>&1; then postmaster --version 2>/dev/null | head -n1; return 0; fi
  if command -v pg_ctl >/dev/null 2>&1; then pg_ctl --version 2>/dev/null | head -n1; return 0; fi
  pgbin="$(ls /usr/lib/postgresql/*/bin/postgres /usr/pgsql-*/bin/postgres 2>/dev/null | head -n1)"
  if [ -n "$pgbin" ]; then "$pgbin" --version 2>/dev/null | head -n1; return 0; fi
  unit="$(systemctl list-unit-files --type=service --no-legend 2>/dev/null | awk "{print \\$1}" | grep -E "^(postgresql|postgresql@[A-Za-z0-9_.-]+|postgresql-[0-9]+)\\.service$" | head -n1)"
  if [ -n "$unit" ]; then echo "systemd: $unit"; return 0; fi
  pkg="$(dpkg -l 2>/dev/null | awk "{print \\$2}" | grep -E "^(postgresql|postgresql-[0-9]+)$" | head -n1)"
  if [ -n "$pkg" ]; then echo "package: $pkg"; return 0; fi
  pkg="$(rpm -qa 2>/dev/null | grep -E "^(postgresql[0-9]*-server|postgresql-server)-" | head -n1)"
  if [ -n "$pkg" ]; then echo "package: $pkg"; return 0; fi
  return 1
}
emit_service() {
  driver="$2"
  port="$3"
  label="$4"
  check="$1"
  detail="$("$check" 2>/dev/null | head -n1 | cut -c1-180)"
  if [ -n "$detail" ]; then
    echo "\${driver}|127.0.0.1|\${port}|\${label}|service|\${detail}"
  fi
}
emit_port 3306 mysql "MySQL / MariaDB"
emit_port 5432 postgres "PostgreSQL"
emit_service mysql_detail mysql 3306 "MySQL / MariaDB"
emit_service postgres_detail postgres 5432 "PostgreSQL"
'
`

function parseDetectedServices(output: string): DatabaseDetectedService[] {
  const map = new Map<string, DatabaseDetectedService>()
  for (const line of output.split(/\r?\n/)) {
    const [driver, host, portRaw, label, detectionKind, ...detailParts] = line.trim().split('|')
    if ((driver !== 'mysql' && driver !== 'postgres') || !host || !portRaw || !label) continue
    const port = Number(portRaw)
    if (!Number.isFinite(port)) continue
    const id = `${driver}:${host}:${port}`
    const prev = map.get(id)
    const detail = detailParts.join('|').trim()
    const serviceDetail =
      detectionKind === 'service' ? detail || prev?.serviceDetail : prev?.serviceDetail
    const portDetail = detectionKind === 'port' ? detail || prev?.portDetail : prev?.portDetail
    map.set(id, {
      id,
      driver,
      host,
      port,
      label,
      hasService: !!prev?.hasService || detectionKind === 'service',
      hasPort: !!prev?.hasPort || detectionKind === 'port',
      serviceDetail,
      portDetail,
      version: serviceDetail?.toLowerCase().includes('version') ? serviceDetail : prev?.version
    })
  }
  return [...map.values()].sort((a, b) => {
    if (a.driver !== b.driver) return a.driver.localeCompare(b.driver)
    return a.port - b.port
  })
}
