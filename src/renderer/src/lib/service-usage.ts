import type { MetricsServiceStatus } from '../../../shared/types'

export interface ServiceUsageGuide {
  title: string
  summary: string
  steps: string[]
  tip?: string
}

export interface ServiceUsageContext {
  host: string
  username?: string
}

function endpoint(host: string, port: number): string {
  return `${host}:${port}`
}

function resolvePort(s: MetricsServiceStatus): number {
  return s.listenPort || s.ports[0] || 0
}

export function getServiceUsage(
  s: MetricsServiceStatus,
  ctx: ServiceUsageContext
): ServiceUsageGuide {
  const host = (ctx.host || '主机IP').trim() || '主机IP'
  const port = resolvePort(s)
  const user = ctx.username || '用户名'
  const stoppedHint =
    s.status !== 'running'
      ? '当前未检测到该服务在监听，以下为常见用法；确认服务已启动且防火墙放行后再连接。'
      : undefined

  const guides: Record<string, () => ServiceUsageGuide> = {
    ssh: () => ({
      title: s.name,
      summary: '通过 SSH 客户端登录到服务器执行命令或管理文件。',
      steps: [
        `可直接在本应用左侧添加主机并连接。`,
        `或使用其它 SSH 工具（如 PuTTY、Tabby、Windows Terminal）连接到 ${user}@${endpoint(host, port || 22)}。`,
        '认证方式一般为密码或私钥，需与服务器配置一致。'
      ],
      tip: stoppedHint
    }),
    http: () => ({
      title: s.name,
      summary: '这是 Web / HTTP 服务，一般用浏览器访问。',
      steps: [
        `在浏览器地址栏打开：http://${endpoint(host, port || 80)}`,
        '若页面打不开，请确认安全组/防火墙已放行对应端口，以及服务是否仅监听 127.0.0.1。'
      ],
      tip: stoppedHint
    }),
    https: () => ({
      title: s.name,
      summary: '这是 HTTPS 网站服务，使用浏览器访问。',
      steps: [
        `在浏览器打开：https://${endpoint(host, port || 443)}`,
        '证书不受信时浏览器可能告警，可按提示继续访问（仅限可信环境）。'
      ],
      tip: stoppedHint
    }),
    mysql: () => ({
      title: s.name,
      summary: '关系型数据库，需使用数据库客户端连接，而不是浏览器。',
      steps: [
        `主机 ${host}，端口 ${port || 3306}。`,
        '推荐工具：Navicat、DBeaver、MySQL Workbench、DataGrip 等。',
        '填写用户名/密码；多数场景默认库为 mysql，具体以服务器账号为准。'
      ],
      tip: stoppedHint || '生产环境请避免将 3306 直接暴露到公网。'
    }),
    postgres: () => ({
      title: s.name,
      summary: 'PostgreSQL 数据库，使用数据库客户端连接。',
      steps: [
        `主机 ${host}，端口 ${port || 5432}。`,
        '推荐工具：DBeaver、pgAdmin、Navicat、DataGrip 等。',
        '默认超级用户常见为 postgres，库名视业务而定。'
      ],
      tip: stoppedHint
    }),
    mongo: () => ({
      title: s.name,
      summary: 'MongoDB 文档数据库，使用专用客户端或驱动连接。',
      steps: [
        `主机 ${host}，端口 ${port || 27017}。`,
        '推荐工具：MongoDB Compass、NoSQLBooster、DBeaver 等。',
        `连接串示例：mongodb://${endpoint(host, port || 27017)}`
      ],
      tip: stoppedHint
    }),
    redis: () => ({
      title: s.name,
      summary: '内存缓存 / 数据结构服务，用 Redis 客户端连接。',
      steps: [
        `主机 ${host}，端口 ${port || 6379}。`,
        '推荐工具：RedisInsight、Another Redis Desktop Manager，或命令行 redis-cli。',
        '若设置了 requirepass，连接时需提供密码。'
      ],
      tip: stoppedHint || 'Redis 默认常只监听内网，公网直连前请确认绑定地址与防火墙。'
    }),
    memcached: () => ({
      title: s.name,
      summary: '分布式内存缓存，通常由应用通过客户端库连接。',
      steps: [
        `主机 ${host}，端口 ${port || 11211}。`,
        '可用 telnet / 专用 Memcached 客户端做探活；业务侧用对应语言的 Memcached SDK。'
      ],
      tip: stoppedHint
    }),
    rabbitmq: () => ({
      title: s.name,
      summary: '消息队列：应用连接 AMQP；也可用浏览器打开管理界面。',
      steps: [
        `AMQP 端口常见 5672；管理台常见 15672。当前相关端口：${s.ports.join(' / ')}${port ? `（当前监听 ${port}）` : ''}。`,
        `管理台可尝试浏览器访问：http://${endpoint(host, 15672)}（需已启用 management 插件）。`,
        '应用侧使用各语言的 AMQP / RabbitMQ 客户端库。'
      ],
      tip: stoppedHint
    }),
    elasticsearch: () => ({
      title: s.name,
      summary: '搜索与分析引擎，一般通过 HTTP REST API 访问。',
      steps: [
        `在浏览器或用 curl 访问：http://${endpoint(host, port || 9200)}`,
        '可用 Kibana、Elasticvue 等工具查看集群与索引。'
      ],
      tip: stoppedHint
    }),
    docker: () => ({
      title: s.name,
      summary: 'Docker 引擎 API。一般不应直接对公网暴露。',
      steps: [
        '推荐在本机或内网用 docker CLI / Docker Desktop 管理容器。',
        `若必须远程：主机 ${host}，API 端口常见 ${port || 2375}（TLS 时常为 2376）。`,
        '公网暴露无认证的 Docker API 风险极高，请使用 TLS 与访问控制。'
      ],
      tip: stoppedHint
    })
  }

  const build = guides[s.id]
  if (build) return build()

  return {
    title: s.name,
    summary: '已根据端口识别到该服务，可用对应协议的客户端连接。',
    steps: [
      `主机 ${host}${port ? `，端口 ${port}` : s.ports.length ? `，常见端口 ${s.ports.join('/')}` : ''}。`,
      `类别：${s.category}。请使用该服务官方或常用客户端连接。`
    ],
    tip: stoppedHint
  }
}
