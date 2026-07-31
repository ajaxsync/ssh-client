import type { DatabaseConnectionConfig, DatabaseConnectionPublic } from '../shared/types'

export function redactDatabaseConnection(
  connection: DatabaseConnectionConfig
): DatabaseConnectionPublic {
  const { password: _password, ...rest } = connection
  return {
    ...rest,
    hasPassword: !!connection.password
  }
}

export function redactDatabaseConnections(
  connections: DatabaseConnectionConfig[]
): DatabaseConnectionPublic[] {
  return connections.map(redactDatabaseConnection)
}

export function mergeDatabaseSecrets(
  incoming: DatabaseConnectionConfig,
  existing?: DatabaseConnectionConfig
): DatabaseConnectionConfig {
  if (!existing) return incoming
  if (incoming.password === '') {
    return { ...incoming, password: existing.password }
  }
  return incoming
}
