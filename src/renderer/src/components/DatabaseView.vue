<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type {
  DatabaseColumnInfo,
  DatabaseConnectionConfig,
  DatabaseConnectionPublic,
  DatabaseDetectedService,
  DatabaseQueryResult,
  DatabaseSchemaInfo,
  DatabaseSessionInfo,
  DatabaseTableInfo,
} from "../../../shared/types";
import { useAppStore } from "../stores/app";
import { useToastStore } from "../stores/toast";
import DatabaseConnectionModal from "./DatabaseConnectionModal.vue";
import GlassTip from "./ui/GlassTip.vue";

const props = defineProps<{
  sessionId: string;
  hostId: string;
  disabled?: boolean;
}>();

const app = useAppStore();
const toast = useToastStore();

const detectedServices = ref<DatabaseDetectedService[]>([]);
const credentials = ref<DatabaseConnectionPublic[]>([]);
const selectedService = ref<DatabaseDetectedService | null>(null);
const dbSession = ref<DatabaseSessionInfo | null>(null);
const schemas = ref<DatabaseSchemaInfo[]>([]);
const tables = ref<DatabaseTableInfo[]>([]);
const schemaTables = ref<Record<string, DatabaseTableInfo[]>>({});
const expandedSchemas = ref<string[]>([]);
const columns = ref<DatabaseColumnInfo[]>([]);
const activeSchema = ref("");
const activeTable = ref("");
const sql = ref("select 1;");
const result = ref<DatabaseQueryResult | null>(null);
const detailTab = ref<"result" | "columns">("result");
const history = ref<string[]>([]);
const showHistory = ref(false);
const showSnippets = ref(false);
const showCompletions = ref(false);
const detecting = ref(false);
const connecting = ref(false);
const executing = ref(false);
const cancelRequested = ref(false);
const exporting = ref(false);
const loadingStructure = ref(false);
const credentialService = ref<DatabaseDetectedService | null>(null);
const editingCredential = ref<DatabaseConnectionConfig | null>(null);
const showCredentialModal = ref(false);
const historyWrap = ref<HTMLElement | null>(null);
const snippetWrap = ref<HTMLElement | null>(null);
const completionWrap = ref<HTMLElement | null>(null);
const sqlEditorRef = ref<HTMLTextAreaElement | null>(null);
const sqlHighlightRef = ref<HTMLElement | null>(null);
const sqlMenuWrap = ref<HTMLElement | null>(null);
const resultColumnWidths = ref<Record<string, number>>({});
const fieldColumnWidths = ref<Record<string, number>>({});
const editorHeight = ref(190);
const leftPaneWidth = ref(420);
const servicePaneHeight = ref(360);
const sqlUndoStack = ref<string[]>([]);
const sqlRedoStack = ref<string[]>([]);
const sqlContextMenu = ref<{
  open: boolean;
  x: number;
  y: number;
  text: string;
}>({
  open: false,
  x: 0,
  y: 0,
  text: "",
});

const fieldTableColumns = [
  { key: "ordinal", label: "序号" },
  { key: "name", label: "字段名" },
  { key: "type", label: "类型" },
  { key: "required", label: "是否必填" },
  { key: "defaultValue", label: "默认值" },
  { key: "ddl", label: "DDL 说明" },
] as const;

type GridKind = "result" | "field";
type FieldColumnKey = (typeof fieldTableColumns)[number]["key"];

let resizing: {
  kind: GridKind;
  key: string;
  startX: number;
  startWidth: number;
} | null = null;

let editorResizing: {
  startY: number;
  startHeight: number;
} | null = null;

let leftPaneResizing: {
  startX: number;
  startWidth: number;
} | null = null;

let servicePaneResizing: {
  startY: number;
  startHeight: number;
} | null = null;

let applyingSqlUndoRedo = false;

const commonSqlSnippets = [
  {
    title: "查所有数据",
    description: "查看 users 表中的所有字段和所有行；数据多时建议加 LIMIT。",
    sql: `-- 查所有数据：* 表示查询表里的全部字段
-- 注意：生产库数据可能很多，建议加 LIMIT 限制返回行数
SELECT * FROM users;

-- 更安全的写法：只查前 100 行
SELECT * FROM users LIMIT 100;`,
  },
  {
    title: "查特定列",
    description: "只查询需要的字段，减少无用数据。",
    sql: `-- 查特定列：只返回 user_id 和 nickname 两个字段
-- 适合只关心部分信息的场景
SELECT user_id, nickname FROM user_info;`,
  },
  {
    title: "条件查询",
    description: "用 WHERE 按条件筛选数据。",
    sql: `-- 条件查询：WHERE 后面写筛选条件
-- = 表示完全相等；字符串要用单引号包起来
SELECT * FROM users WHERE phone = '123';

-- 多个条件：AND 表示同时满足
SELECT * FROM users WHERE phone = '123' AND status = 'active';

-- 任一条件：OR 表示满足其中一个即可
SELECT * FROM users WHERE phone = '123' OR nickname = '张三';`,
  },
  {
    title: "模糊查询",
    description: "用 LIKE 按关键字搜索。",
    sql: `-- 模糊查询：LIKE 用来按关键字搜索
-- % 表示任意多个字符
-- 下面表示 nickname 中包含“张”的用户
SELECT * FROM user_info WHERE nickname LIKE '%张%';

-- 以“张”开头
SELECT * FROM user_info WHERE nickname LIKE '张%';

-- 以“三”结尾
SELECT * FROM user_info WHERE nickname LIKE '%三';`,
  },
  {
    title: "范围和列表查询",
    description: "按多个值、时间范围、空值筛选。",
    sql: `-- IN：匹配多个指定值
SELECT * FROM users WHERE id IN (1, 2, 3);

-- BETWEEN：查询范围，常用于数字或时间
SELECT * FROM users WHERE created_at BETWEEN '2026-01-01' AND '2026-12-31';

-- IS NULL：查询字段为空的数据
SELECT * FROM users WHERE deleted_at IS NULL;

-- IS NOT NULL：查询字段不为空的数据
SELECT * FROM users WHERE deleted_at IS NOT NULL;`,
  },
  {
    title: "排序和分页",
    description: "按字段排序，并按页查询。",
    sql: `-- 排序：ORDER BY 指定排序字段
-- ASC：升序，小到大；DESC：降序，大到小
SELECT * FROM users ORDER BY id DESC;

-- 分页：LIMIT 表示每页条数，OFFSET 表示跳过多少条
-- pageSize = 10，pageNo = 1，则 OFFSET = (1 - 1) * 10 = 0
SELECT * FROM users ORDER BY id DESC LIMIT 10 OFFSET 0;

-- 第 2 页：OFFSET = (2 - 1) * 10 = 10
SELECT * FROM users ORDER BY id DESC LIMIT 10 OFFSET 10;`,
  },
  {
    title: "统计数量",
    description: "统计总数、分组数量。",
    sql: `-- COUNT(*)：统计符合条件的数据有多少条
SELECT COUNT(*) AS total FROM users;

-- 带条件统计
SELECT COUNT(*) AS active_total FROM users WHERE status = 'active';

-- GROUP BY：按字段分组统计
-- 下面表示统计每个 status 各有多少用户
SELECT status, COUNT(*) AS total
FROM users
GROUP BY status;`,
  },
  {
    title: "聚合计算",
    description: "求和、平均值、最大值、最小值。",
    sql: `-- SUM：求和；AVG：平均值；MAX：最大值；MIN：最小值
-- 假设 orders 表有 amount 金额字段
SELECT
  SUM(amount) AS total_amount,
  AVG(amount) AS avg_amount,
  MAX(amount) AS max_amount,
  MIN(amount) AS min_amount
FROM orders;

-- 按用户统计订单总金额
SELECT user_id, SUM(amount) AS total_amount
FROM orders
GROUP BY user_id;`,
  },
  {
    title: "分组后筛选",
    description: "用 HAVING 筛选分组统计结果。",
    sql: `-- WHERE 是分组前筛选；HAVING 是分组后筛选
-- 下面表示找出订单数大于 5 的用户
SELECT user_id, COUNT(*) AS order_count
FROM orders
GROUP BY user_id
HAVING COUNT(*) > 5;`,
  },
  {
    title: "去重查询",
    description: "查询不重复的字段值。",
    sql: `-- DISTINCT：去重
-- 下面表示查询 users 表中所有出现过的 status
SELECT DISTINCT status FROM users;

-- 多字段去重：组合完全相同才会合并
SELECT DISTINCT city, status FROM users;`,
  },
  {
    title: "关联查询",
    description: "把两张表按关联字段合并查询。",
    sql: `-- JOIN：关联查询，把多张表的数据合在一起看
-- users.id 和 orders.user_id 是关联字段
SELECT
  users.id,
  users.name,
  orders.id AS order_id,
  orders.amount
FROM users
JOIN orders ON orders.user_id = users.id
ORDER BY orders.id DESC
LIMIT 20;

-- LEFT JOIN：即使右表没有匹配数据，也保留左表 users 的数据
SELECT
  users.id,
  users.name,
  orders.id AS order_id
FROM users
LEFT JOIN orders ON orders.user_id = users.id;`,
  },
  {
    title: "新增数据",
    description: "向表中插入一行或多行。",
    sql: `-- 新增一条数据：字段名和值要一一对应
INSERT INTO users (id, name, phone) VALUES (1, '张三', '123');

-- 一次新增多条数据
INSERT INTO users (id, name, phone) VALUES
  (2, '李四', '456'),
  (3, '王五', '789');`,
  },
  {
    title: "修改数据",
    description: "更新已有数据，必须带 WHERE。",
    sql: `-- 修改数据：SET 后面写要修改的字段
-- 一定要写 WHERE，否则可能修改整张表
UPDATE users SET phone = '456' WHERE id = 1;

-- 同时修改多个字段
UPDATE users
SET name = '张三三', phone = '999'
WHERE id = 1;`,
  },
  {
    title: "删除数据",
    description: "删除已有数据，必须带 WHERE。",
    sql: `-- 删除数据：一定要写 WHERE，否则可能删除整张表
DELETE FROM users WHERE id = 1;

-- 按条件删除
DELETE FROM users WHERE status = 'disabled' AND deleted_at IS NOT NULL;`,
  },
  {
    title: "事务操作",
    description: "多步修改要么全部成功，要么全部撤销。",
    sql: `-- 事务：适合多条写入语句必须一起成功的场景
-- BEGIN 开始事务
BEGIN;

UPDATE users SET phone = '456' WHERE id = 1;
INSERT INTO user_logs (user_id, action) VALUES (1, 'update phone');

-- 确认无误后提交
COMMIT;

-- 如果中途发现问题，执行 ROLLBACK 撤销本次事务
-- ROLLBACK;`,
  },
];

const manualServices: DatabaseDetectedService[] = [
  {
    id: "mysql:127.0.0.1:3306",
    driver: "mysql",
    host: "127.0.0.1",
    port: 3306,
    label: "MySQL / MariaDB",
    hasService: false,
    hasPort: false,
    serviceDetail: "未自动探测到 MySQL/MariaDB 服务端",
    portDetail: "未探测到 3306 本机监听",
    manual: true,
  },
  {
    id: "postgres:127.0.0.1:5432",
    driver: "postgres",
    host: "127.0.0.1",
    port: 5432,
    label: "PostgreSQL",
    hasService: false,
    hasPort: false,
    serviceDetail: "未自动探测到 PostgreSQL 服务端",
    portDetail: "未探测到 5432 本机监听",
    manual: true,
  },
];

const services = computed(() => {
  const map = new Map<string, DatabaseDetectedService>();
  for (const service of manualServices) map.set(service.id, service);
  for (const service of detectedServices.value) map.set(service.id, service);
  return [...map.values()];
});

const activeCredential = computed(() => {
  const connectionId = dbSession.value?.connectionId;
  return credentials.value.find((credential) => credential.id === connectionId);
});

const structureTitle = computed(() => {
  if (selectedService.value?.driver === "postgres") return "PostgreSQL 结构";
  return "数据库结构";
});

const structureSubtitle = computed(() => {
  if (!dbSession.value) return "";
  if (selectedService.value?.driver === "postgres") {
    return `Database: ${dbSession.value.database || activeCredential.value?.database || "默认"} / Schema`;
  }
  return "Database / 表";
});

const completionItems = computed(() => {
  const keywords = [
    "SELECT",
    "FROM",
    "WHERE",
    "ORDER BY",
    "GROUP BY",
    "LIMIT",
    "INSERT INTO",
    "UPDATE",
    "DELETE FROM",
    "BEGIN",
    "COMMIT",
    "ROLLBACK",
  ];
  const tableNames = Object.values(schemaTables.value)
    .flat()
    .map((table) => quoteTable(table.schema, table.name));
  const columnNames = columns.value.map((column) =>
    quoteIdentifier(column.name),
  );
  return [...new Set([...keywords, ...tableNames, ...columnNames])].slice(
    0,
    80,
  );
});

const highlightedSql = computed(() => highlightSql(sql.value));

async function loadCredentials(): Promise<void> {
  credentials.value = await app.listDatabaseConnections(props.hostId);
}

async function detectServices(): Promise<void> {
  if (props.disabled) return;
  detecting.value = true;
  try {
    const res = await window.api.database.detectServices(props.sessionId);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    detectedServices.value = res.data;
  } finally {
    detecting.value = false;
  }
}

function credentialFor(
  service: DatabaseDetectedService,
): DatabaseConnectionPublic | undefined {
  return credentials.value.find(
    (credential) =>
      credential.driver === service.driver &&
      credential.dbHost === service.host &&
      credential.dbPort === service.port,
  );
}

async function openCredential(service: DatabaseDetectedService): Promise<void> {
  const publicCredential = credentialFor(service);
  editingCredential.value = publicCredential
    ? await app.getDatabaseConnection(publicCredential.id)
    : null;
  if (publicCredential && !editingCredential.value) {
    toast.error(app.error || "读取凭据失败");
    return;
  }
  credentialService.value = service;
  showCredentialModal.value = true;
}

async function connectService(service: DatabaseDetectedService): Promise<void> {
  const credential = credentialFor(service);
  if (!credential) {
    await openCredential(service);
    return;
  }
  await connectCredential(service, credential.id);
}

async function connectCredential(
  service: DatabaseDetectedService,
  credentialId: string,
): Promise<void> {
  if (props.disabled) return;
  if (dbSession.value) await disconnect();
  selectedService.value = service;
  connecting.value = true;
  try {
    const res = await window.api.database.connect(
      props.sessionId,
      credentialId,
    );
    if (!res.ok) {
      toast.error(res.error, 8000);
      return;
    }
    dbSession.value = res.data;
    result.value = null;
    await Promise.all([loadStructure(), loadHistory(credentialId)]);
    toast.success("数据库已连接");
  } finally {
    connecting.value = false;
  }
}

async function onCredentialSaved(connectionId: string): Promise<void> {
  const service = credentialService.value;
  showCredentialModal.value = false;
  credentialService.value = null;
  await loadCredentials();
  toast.success("凭据已保存");
  if (service) await connectCredential(service, connectionId);
}

async function disconnect(): Promise<void> {
  const current = dbSession.value;
  dbSession.value = null;
  schemas.value = [];
  tables.value = [];
  schemaTables.value = {};
  expandedSchemas.value = [];
  columns.value = [];
  detailTab.value = "result";
  activeSchema.value = "";
  activeTable.value = "";
  if (current) await window.api.database.disconnect(current.dbSessionId);
}

async function loadStructure(): Promise<void> {
  if (!dbSession.value) return;
  loadingStructure.value = true;
  try {
    const res = await window.api.database.listSchemas(
      dbSession.value.dbSessionId,
    );
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    schemas.value = res.data;
    activeSchema.value = schemas.value[0]?.name ?? "";
  } finally {
    loadingStructure.value = false;
  }
}

async function loadTables(schema: string): Promise<void> {
  if (!dbSession.value) return;
  activeSchema.value = schema;
  const res = await window.api.database.listTables(
    dbSession.value.dbSessionId,
    schema,
  );
  if (!res.ok) {
    toast.error(res.error);
    return;
  }
  tables.value = res.data;
  schemaTables.value = { ...schemaTables.value, [schema]: res.data };
}

async function toggleSchema(schema: string): Promise<void> {
  if (expandedSchemas.value.includes(schema)) {
    expandedSchemas.value = expandedSchemas.value.filter(
      (item) => item !== schema,
    );
    return;
  }
  expandedSchemas.value = [...expandedSchemas.value, schema];
  if (!schemaTables.value[schema]) await loadTables(schema);
}

function tablesForSchema(schema: string): DatabaseTableInfo[] {
  return schemaTables.value[schema] ?? [];
}

async function selectTable(table: DatabaseTableInfo): Promise<void> {
  if (!dbSession.value) return;
  if (executing.value) {
    toast.error("当前 SQL 正在执行，请稍后再预览表数据");
    return;
  }
  activeSchema.value = table.schema;
  activeTable.value = table.name;
  const previewSql = `select * from ${quoteTable(table.schema, table.name)} limit 100;`;
  appendSqlToEditor(previewSql);
  const res = await window.api.database.listColumns(
    dbSession.value.dbSessionId,
    table.schema,
    table.name,
  );
  if (!res.ok) {
    toast.error(res.error);
    return;
  }
  columns.value = res.data;
  detailTab.value = "columns";
}

async function executeSql(
  sqlText = sql.value,
  options: { saveHistory?: boolean } = {},
): Promise<void> {
  const statement = sqlText.trim();
  if (!dbSession.value || !activeCredential.value || !statement) return;
  if (executing.value) {
    toast.error("当前 SQL 正在执行");
    return;
  }
  const riskRes = await window.api.database.assessSql(
    statement,
    activeCredential.value.readonly,
  );
  if (!riskRes.ok) {
    toast.error(riskRes.error);
    return;
  }
  if (riskRes.data.readonlyBlocked) {
    toast.error("当前凭据为只读模式，不能执行写入或结构变更语句");
    return;
  }

  let confirmed = false;
  if (riskRes.data.level !== "safe") {
    const message = [
      riskRes.data.level === "danger" ? "高风险 SQL" : "写入 SQL",
      ...riskRes.data.reasons,
    ].join("：");
    if (!confirm(`${message}\n\n确认执行？`)) return;
    confirmed = true;
  }

  const session = dbSession.value;
  executing.value = true;
  try {
    const res = await window.api.database.execute(
      session.dbSessionId,
      session.connectionId,
      statement,
      confirmed,
      options.saveHistory !== false,
    );
    if (!res.ok) {
      if (cancelRequested.value) toast.info("查询已取消");
      else toast.error(res.error, 8000);
      return;
    }
    result.value = res.data;
    resultColumnWidths.value = {};
    detailTab.value = "result";
    if (options.saveHistory !== false) await loadHistory(session.connectionId);
  } finally {
    executing.value = false;
    cancelRequested.value = false;
  }
}

async function cancelSql(): Promise<void> {
  if (!dbSession.value || !executing.value) return;
  cancelRequested.value = true;
  const res = await window.api.database.cancel(dbSession.value.dbSessionId);
  if (!res.ok) {
    cancelRequested.value = false;
    toast.error(res.error, 8000);
    return;
  }
  toast.info(res.data.message, 5000);
}

async function exportResultCsv(): Promise<void> {
  if (!result.value) {
    toast.error("没有可导出的查询结果");
    return;
  }
  if (!result.value.columns.length) {
    toast.error("当前结果没有可导出的列");
    return;
  }
  exporting.value = true;
  try {
    const name = activeTable.value
      ? `${safeFileName(activeTable.value)}-result.csv`
      : "query-result.csv";
    const res = await window.api.database.exportCsv(
      result.value.columns,
      result.value.rows,
      name,
    );
    if (!res.ok) {
      toast.error(res.error, 8000);
      return;
    }
    if (res.data) toast.success("CSV 已导出");
    else toast.info("已取消导出");
  } finally {
    exporting.value = false;
  }
}

function safeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 80) || "query";
}

function selectedSqlText(): string {
  const el = sqlEditorRef.value;
  if (!el) return "";
  return sql.value.slice(el.selectionStart, el.selectionEnd).trim();
}

function appendSqlToEditor(text: string): void {
  const snippet = text.trim();
  if (!snippet) return;
  const separator = sql.value.trim() ? (sql.value.endsWith("\n") ? "\n" : "\n\n") : "";
  const start = sql.value.length + separator.length;
  sql.value = `${sql.value}${separator}${snippet}`;
  requestAnimationFrame(() => {
    const el = sqlEditorRef.value;
    if (!el) return;
    el.focus();
    el.setSelectionRange(start, start + snippet.length);
    el.scrollTop = el.scrollHeight;
    syncSqlHighlightScroll();
  });
}

function openSqlContextMenu(event: MouseEvent): void {
  const text = selectedSqlText();
  if (!text) {
    sqlContextMenu.value.open = false;
    return;
  }
  sqlContextMenu.value = {
    open: true,
    x: event.clientX,
    y: event.clientY,
    text,
  };
}

async function executeSelectedSql(): Promise<void> {
  const text =
    selectedSqlText() ||
    (sqlContextMenu.value.open ? sqlContextMenu.value.text.trim() : "");
  sqlContextMenu.value.open = false;
  if (!text) {
    toast.error("请先选中要执行的 SQL");
    return;
  }
  await executeSql(text);
}

function copySelectedSql(): void {
  const text =
    selectedSqlText() ||
    (sqlContextMenu.value.open ? sqlContextMenu.value.text.trim() : "");
  sqlContextMenu.value.open = false;
  if (!text) {
    toast.error("请先选中要复制的 SQL");
    return;
  }
  window.api.clipboard.writeText(text);
  toast.success("SQL 已复制");
}

function undoSql(): void {
  const previous = sqlUndoStack.value.pop();
  if (previous === undefined) return;
  applyingSqlUndoRedo = true;
  sqlRedoStack.value = [...sqlRedoStack.value, sql.value];
  sql.value = previous;
  requestAnimationFrame(() => {
    sqlEditorRef.value?.focus();
    applyingSqlUndoRedo = false;
  });
}

function redoSql(): void {
  const next = sqlRedoStack.value.pop();
  if (next === undefined) return;
  applyingSqlUndoRedo = true;
  sqlUndoStack.value = [...sqlUndoStack.value, sql.value];
  sql.value = next;
  requestAnimationFrame(() => {
    sqlEditorRef.value?.focus();
    applyingSqlUndoRedo = false;
  });
}

function onSqlEditorKeydown(event: KeyboardEvent): void {
  const isUndo =
    (event.ctrlKey || event.metaKey) &&
    !event.shiftKey &&
    event.key.toLowerCase() === "z";
  const isRedo =
    ((event.ctrlKey || event.metaKey) &&
      event.shiftKey &&
      event.key.toLowerCase() === "z") ||
    ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y");
  if (isUndo) {
    event.preventDefault();
    undoSql();
  } else if (isRedo) {
    event.preventDefault();
    redoSql();
  }
}

function formatSql(): void {
  const el = sqlEditorRef.value;
  const start = el?.selectionStart ?? 0;
  const end = el?.selectionEnd ?? 0;
  const selected = start !== end ? sql.value.slice(start, end) : "";
  const formatted = formatSqlText(selected || sql.value);
  if (selected) {
    sql.value = `${sql.value.slice(0, start)}${formatted}${sql.value.slice(end)}`;
  } else {
    sql.value = formatted;
  }
}

function formatSqlText(input: string): string {
  return input
    .replace(/\s+/g, " ")
    .replace(/\s*(select)\s+/gi, "SELECT ")
    .replace(/\s+(from)\s+/gi, "\nFROM ")
    .replace(/\s+(where)\s+/gi, "\nWHERE ")
    .replace(/\s+(left join|right join|inner join|join)\s+/gi, "\n$1 ")
    .replace(/\s+(group by)\s+/gi, "\nGROUP BY ")
    .replace(/\s+(order by)\s+/gi, "\nORDER BY ")
    .replace(/\s+(limit)\s+/gi, "\nLIMIT ")
    .replace(/\s+(offset)\s+/gi, "\nOFFSET ")
    .replace(/\s+(values)\s*/gi, "\nVALUES ")
    .replace(/\s+(set)\s+/gi, "\nSET ")
    .replace(/\s+(and)\s+/gi, "\n  AND ")
    .replace(/\s+(or)\s+/gi, "\n  OR ")
    .replace(/;\s*/g, ";\n")
    .trim();
}

function insertCompletion(text: string): void {
  const el = sqlEditorRef.value;
  if (!el) {
    sql.value += text;
    showCompletions.value = false;
    return;
  }
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const prefix = sql.value.slice(0, start);
  const suffix = sql.value.slice(end);
  const spacer = prefix && !/\s$/.test(prefix) ? " " : "";
  const insert = `${spacer}${text}`;
  sql.value = `${prefix}${insert}${suffix}`;
  showCompletions.value = false;
  requestAnimationFrame(() => {
    const pos = start + insert.length;
    el.focus();
    el.setSelectionRange(pos, pos);
  });
}

function syncSqlHighlightScroll(): void {
  if (!sqlEditorRef.value || !sqlHighlightRef.value) return;
  sqlHighlightRef.value.scrollTop = sqlEditorRef.value.scrollTop;
  sqlHighlightRef.value.scrollLeft = sqlEditorRef.value.scrollLeft;
}

function highlightSql(input: string): string {
  const tokenPattern =
    /(--[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:\\"|[^"])*"|`[^`]*`|\b(?:SELECT|FROM|WHERE|AND|OR|ORDER|BY|GROUP|HAVING|LIMIT|OFFSET|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|ALTER|DROP|TRUNCATE|TABLE|VIEW|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AS|NULL|NOT|DEFAULT|PRIMARY|KEY|BEGIN|COMMIT|ROLLBACK|EXPLAIN|SHOW|DESC|DESCRIBE)\b|\b\d+(?:\.\d+)?\b)/gi;
  let html = "";
  let lastIndex = 0;
  for (const match of input.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    html += escapeHtml(input.slice(lastIndex, index));
    const token = match[0];
    html += `<span class="${sqlTokenClass(token)}">${escapeHtml(token)}</span>`;
    lastIndex = index + token.length;
  }
  html += escapeHtml(input.slice(lastIndex));
  return html || " ";
}

function sqlTokenClass(token: string): string {
  if (/^(--|#|\/\*)/.test(token)) return "tok-comment";
  if (/^('|"|`)/.test(token)) return "tok-string";
  if (/^\d/.test(token)) return "tok-number";
  return "tok-keyword";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function loadHistory(
  connectionId = dbSession.value?.connectionId,
): Promise<void> {
  if (!connectionId) {
    history.value = [];
    return;
  }
  const res = await window.api.database.listHistory(connectionId);
  history.value = res.ok ? res.data : [];
}

function pickHistory(item: string): void {
  sql.value = item;
  showHistory.value = false;
}

async function deleteHistoryItem(item: string, event: Event): Promise<void> {
  event.stopPropagation();
  const connectionId = dbSession.value?.connectionId;
  if (!connectionId) return;
  const res = await window.api.database.deleteHistory(connectionId, item);
  if (!res.ok) {
    toast.error(res.error);
    return;
  }
  history.value = res.data;
}

async function clearHistory(): Promise<void> {
  const connectionId = dbSession.value?.connectionId;
  if (!connectionId || !history.value.length) return;
  if (!confirm("清空当前数据库连接的全部 SQL 历史？")) return;
  const res = await window.api.database.clearHistory(connectionId);
  if (!res.ok) {
    toast.error(res.error);
    return;
  }
  history.value = res.data;
  showHistory.value = false;
}

function pickSnippet(item: { sql: string }): void {
  appendSqlToEditor(item.sql);
  showSnippets.value = false;
}

function formatCell(value: unknown): string {
  if (value === null) return "NULL";
  if (value === undefined) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function fieldCellValue(
  column: DatabaseColumnInfo,
  key: FieldColumnKey,
): string {
  if (key === "ordinal") return String(column.ordinal);
  if (key === "name") return column.name;
  if (key === "type") return column.type;
  if (key === "required") return column.nullable ? "否" : "是";
  if (key === "defaultValue") return column.defaultValue ?? "无";
  return columnDdl(column);
}

function columnDdl(column: DatabaseColumnInfo): string {
  const parts = [
    quoteIdentifier(column.name),
    column.type,
    column.nullable ? "NULL" : "NOT NULL",
  ];
  if (column.defaultValue !== undefined)
    parts.push(`DEFAULT ${column.defaultValue}`);
  return parts.join(" ");
}

function columnHoverText(column: DatabaseColumnInfo): string {
  return [
    `字段：${column.name}`,
    `DDL：${columnDdl(column)}`,
    `是否必填：${column.nullable ? "否，可为空" : "是，不能为空"}`,
    `默认值：${column.defaultValue ?? "无"}`,
  ].join("\n");
}

function isServiceConnected(service: DatabaseDetectedService): boolean {
  return !!dbSession.value && selectedService.value?.id === service.id;
}

function quoteTable(schema: string, table: string): string {
  const driver = selectedService.value?.driver;
  if (driver === "postgres")
    return `"${schema.replace(/"/g, '""')}"."${table.replace(/"/g, '""')}"`;
  return `\`${schema.replace(/`/g, "``")}\`.\`${table.replace(/`/g, "``")}\``;
}

function quoteIdentifier(name: string): string {
  if (selectedService.value?.driver === "postgres")
    return `"${name.replace(/"/g, '""')}"`;
  return `\`${name.replace(/`/g, "``")}\``;
}

function columnStyle(kind: GridKind, key: string): Record<string, string> {
  const width =
    kind === "result"
      ? resultColumnWidths.value[key]
      : fieldColumnWidths.value[key];
  return width ? { width: `${width}px`, minWidth: `${width}px` } : {};
}

function startColumnResize(
  kind: GridKind,
  key: string,
  event: PointerEvent,
): void {
  const th = (event.currentTarget as HTMLElement).closest(
    "th",
  ) as HTMLElement | null;
  if (!th) return;
  resizing = {
    kind,
    key,
    startX: event.clientX,
    startWidth: th.getBoundingClientRect().width,
  };
  window.addEventListener("pointermove", onColumnResize);
  window.addEventListener("pointerup", stopColumnResize, { once: true });
}

function onColumnResize(event: PointerEvent): void {
  if (!resizing) return;
  const nextWidth = Math.max(
    80,
    Math.round(resizing.startWidth + event.clientX - resizing.startX),
  );
  if (resizing.kind === "result") {
    resultColumnWidths.value = {
      ...resultColumnWidths.value,
      [resizing.key]: nextWidth,
    };
  } else {
    fieldColumnWidths.value = {
      ...fieldColumnWidths.value,
      [resizing.key]: nextWidth,
    };
  }
}

function stopColumnResize(): void {
  resizing = null;
  window.removeEventListener("pointermove", onColumnResize);
}

function startEditorResize(event: PointerEvent): void {
  editorResizing = {
    startY: event.clientY,
    startHeight: editorHeight.value,
  };
  window.addEventListener("pointermove", onEditorResize);
  window.addEventListener("pointerup", stopEditorResize, { once: true });
}

function onEditorResize(event: PointerEvent): void {
  if (!editorResizing) return;
  editorHeight.value = Math.max(
    120,
    Math.min(
      420,
      Math.round(
        editorResizing.startHeight + event.clientY - editorResizing.startY,
      ),
    ),
  );
}

function stopEditorResize(): void {
  editorResizing = null;
  window.removeEventListener("pointermove", onEditorResize);
}

function startLeftPaneResize(event: PointerEvent): void {
  leftPaneResizing = {
    startX: event.clientX,
    startWidth: leftPaneWidth.value,
  };
  window.addEventListener("pointermove", onLeftPaneResize);
  window.addEventListener("pointerup", stopLeftPaneResize, { once: true });
}

function onLeftPaneResize(event: PointerEvent): void {
  if (!leftPaneResizing) return;
  leftPaneWidth.value = Math.max(
    340,
    Math.min(
      640,
      Math.round(
        leftPaneResizing.startWidth + event.clientX - leftPaneResizing.startX,
      ),
    ),
  );
}

function stopLeftPaneResize(): void {
  leftPaneResizing = null;
  window.removeEventListener("pointermove", onLeftPaneResize);
}

function startServicePaneResize(event: PointerEvent): void {
  servicePaneResizing = {
    startY: event.clientY,
    startHeight: servicePaneHeight.value,
  };
  window.addEventListener("pointermove", onServicePaneResize);
  window.addEventListener("pointerup", stopServicePaneResize, { once: true });
}

function onServicePaneResize(event: PointerEvent): void {
  if (!servicePaneResizing) return;
  servicePaneHeight.value = Math.max(
    240,
    Math.min(
      560,
      Math.round(
        servicePaneResizing.startHeight +
          event.clientY -
          servicePaneResizing.startY,
      ),
    ),
  );
}

function stopServicePaneResize(): void {
  servicePaneResizing = null;
  window.removeEventListener("pointermove", onServicePaneResize);
}

function onDocPointerDown(e: PointerEvent): void {
  if (
    !showHistory.value &&
    !showSnippets.value &&
    !showCompletions.value &&
    !sqlContextMenu.value.open
  ) {
    return;
  }
  const target = e.target as Node;
  if (
    historyWrap.value?.contains(target) ||
    snippetWrap.value?.contains(target) ||
    completionWrap.value?.contains(target) ||
    sqlMenuWrap.value?.contains(target)
  ) {
    return;
  }
  showHistory.value = false;
  showSnippets.value = false;
  showCompletions.value = false;
  sqlContextMenu.value.open = false;
}

async function refreshAll(): Promise<void> {
  await Promise.all([loadCredentials(), detectServices()]);
}

watch(
  () => props.sessionId,
  async () => {
    await disconnect();
    selectedService.value = null;
    await refreshAll();
  },
);

watch(
  () => props.disabled,
  async (disabled) => {
    if (disabled) await disconnect();
  },
);

watch(sql, (next, previous) => {
  if (applyingSqlUndoRedo || next === previous) return;
  sqlUndoStack.value = [...sqlUndoStack.value.slice(-99), previous];
  sqlRedoStack.value = [];
});

onMounted(async () => {
  document.addEventListener("pointerdown", onDocPointerDown, true);
  await refreshAll();
});

onUnmounted(() => {
  document.removeEventListener("pointerdown", onDocPointerDown, true);
  stopColumnResize();
  stopEditorResize();
  stopLeftPaneResize();
  stopServicePaneResize();
  void disconnect();
});
</script>

<template>
  <div class="database" :class="{ disabled }">
    <div
      class="workbench"
      :style="{ '--left-pane-width': `${leftPaneWidth}px` }"
    >
      <aside class="service-pane">
        <section
          class="pane-section service-section"
          :style="{ flexBasis: `${servicePaneHeight}px` }"
        >
          <div class="pane-title title-row">
            <span>当前服务器数据库</span>
            <button
              type="button"
              class="pane-icon"
              title="重新检测"
              :disabled="disabled || detecting"
              @click="refreshAll"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M17.7 6.3A8 8 0 0 0 4.3 10H2l3.5 3.5L9 10H6.4a6 6 0 0 1 10-2.3L14 10h8V2l-4.3 4.3zM6.3 17.7A8 8 0 0 0 19.7 14H22l-3.5-3.5L15 14h2.6a6 6 0 0 1-10 2.3L10 14H2v8l4.3-4.3z"
                />
              </svg>
            </button>
          </div>
          <div class="service-list">
            <div
              v-for="service in services"
              :key="service.id"
              role="button"
              tabindex="0"
              class="service-card"
              :class="{
                active: selectedService?.id === service.id,
                connected: isServiceConnected(service),
              }"
              @click="connectService(service)"
              @keydown.enter.prevent="connectService(service)"
              @keydown.space.prevent="connectService(service)"
            >
              <div class="svc-main">
                <span class="svc-title">
                  <span
                    class="status-dot"
                    :class="{ connected: isServiceConnected(service) }"
                  />
                  <strong>{{ service.label }}</strong>
                </span>
                <span class="svc-right">
                  <span>{{ service.host }}:{{ service.port }}</span>
                </span>
              </div>
              <div class="svc-meta">
                <span
                  class="svc-check"
                  :class="{ ok: service.hasService }"
                  :title="service.serviceDetail"
                >
                  服务 {{ service.hasService ? "✓" : "✕" }}
                </span>
                <span
                  class="svc-check"
                  :class="{ ok: service.hasPort }"
                  :title="service.portDetail"
                >
                  端口 {{ service.hasPort ? "✓" : "✕" }}
                </span>
                <span v-if="credentialFor(service)">已有凭据</span>
                <span v-else>需登录</span>
              </div>
              <div class="svc-actions">
                <button
                  v-if="!isServiceConnected(service)"
                  type="button"
                  class="svc-action"
                  title="连接数据库"
                  :disabled="disabled || connecting"
                  @click.stop="connectService(service)"
                >
                  ▶
                </button>
                <button
                  v-else
                  type="button"
                  class="svc-action"
                  title="停止连接"
                  @click.stop="disconnect"
                >
                  ⏹
                </button>
                <button
                  type="button"
                  class="svc-action"
                  title="设置凭据"
                  :disabled="disabled"
                  @click.stop="openCredential(service)"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M19.43 12.98c.04-.32.07-.65.07-.98s-.02-.66-.07-.98l2.11-1.65-2-3.46-2.49 1a7.3 7.3 0 0 0-1.69-.98L15 3.25h-4l-.36 2.68c-.6.23-1.17.56-1.69.98l-2.49-1-2 3.46 2.11 1.65c-.04.32-.07.65-.07.98s.02.66.07.98l-2.11 1.65 2 3.46 2.49-1c.52.4 1.09.73 1.69.98L11 20.75h4l.36-2.68c.6-.25 1.17-.58 1.69-.98l2.49 1 2-3.46-2.11-1.65zM13 15.5A3.5 3.5 0 1 1 13 8a3.5 3.5 0 0 1 0 7.5z"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </section>

        <div
          class="pane-v-splitter"
          title="拖动调整上下区域大小"
          @pointerdown.prevent="startServicePaneResize"
        />

        <section class="pane-section structure-section">
          <div class="pane-title structure-heading">
            <span>{{ structureTitle }}</span>
            <em v-if="structureSubtitle">{{ structureSubtitle }}</em>
          </div>
          <div class="structure-list">
            <div v-if="!dbSession" class="pane-empty">
              连接数据库后显示 schema 和表。
            </div>
            <div v-else-if="loadingStructure" class="pane-empty">
              读取结构中…
            </div>
            <template v-else>
              <div
                v-for="schema in schemas"
                :key="schema.name"
                class="schema-node"
              >
                <button
                  type="button"
                  class="schema-item"
                  :class="{
                    active: schema.name === activeSchema,
                    expanded: expandedSchemas.includes(schema.name),
                  }"
                  @click="toggleSchema(schema.name)"
                >
                  <span class="schema-name">
                    <span class="chev">{{
                      expandedSchemas.includes(schema.name) ? "▾" : "▸"
                    }}</span>
                    {{ schema.name }}
                  </span>
                  <em>{{ tablesForSchema(schema.name).length || "未展开" }}</em>
                </button>
                <div
                  v-if="expandedSchemas.includes(schema.name)"
                  class="table-list"
                >
                  <button
                    v-for="table in tablesForSchema(schema.name)"
                    :key="`${table.schema}.${table.name}`"
                    type="button"
                    class="table-item"
                    :class="{
                      active:
                        table.schema === activeSchema &&
                        table.name === activeTable,
                    }"
                    @click="selectTable(table)"
                  >
                    <span>{{ table.name }}</span>
                    <em>{{ table.type === "view" ? "视图" : "表" }}</em>
                  </button>
                  <div
                    v-if="!tablesForSchema(schema.name).length"
                    class="table-empty"
                  >
                    暂无表
                  </div>
                </div>
              </div>
            </template>
          </div>
        </section>
      </aside>

      <div
        class="side-splitter"
        title="拖动调整左侧面板宽度"
        @pointerdown.prevent="startLeftPaneResize"
      />

      <section class="query-pane">
        <div class="editor-head">
          <div class="editor-title">
            SQL 工作台
            <span v-if="selectedService" class="sub">
              {{ selectedService.label }} · {{ selectedService.host }}:{{
                selectedService.port
              }}
            </span>
          </div>
          <div ref="snippetWrap" class="menu-wrap">
            <GlassTip text="常用 SQL 示例" mode="wrap">
              <button
                type="button"
                class="btn-glass sm"
                @click="showSnippets = !showSnippets"
              >
                常用
              </button>
            </GlassTip>
            <div v-if="showSnippets" class="snippet-menu">
              <button
                v-for="item in commonSqlSnippets"
                :key="item.title"
                type="button"
                class="snippet-item"
                @click="pickSnippet(item)"
              >
                <strong>{{ item.title }}</strong>
                <span>{{ item.description }}</span>
              </button>
            </div>
          </div>
          <div ref="completionWrap" class="menu-wrap">
            <GlassTip text="插入关键字、表名或字段名" mode="wrap">
              <button
                type="button"
                class="btn-glass sm"
                :disabled="!dbSession"
                @click="showCompletions = !showCompletions"
              >
                补全
              </button>
            </GlassTip>
            <div v-if="showCompletions" class="completion-menu">
              <button
                v-for="item in completionItems"
                :key="item"
                type="button"
                class="completion-item"
                :title="item"
                @click="insertCompletion(item)"
              >
                {{ item }}
              </button>
            </div>
          </div>
          <button
            class="btn-glass sm"
            type="button"
            :disabled="!sql.trim()"
            @click="formatSql"
          >
            格式化
          </button>
          <div ref="historyWrap" class="history-wrap">
            <GlassTip text="当前凭据的 SQL 历史" mode="wrap">
              <button
                type="button"
                class="btn-glass sm"
                :disabled="!history.length"
                @click="showHistory = !showHistory"
              >
                历史
              </button>
            </GlassTip>
            <div v-if="showHistory" class="history-menu">
              <div class="history-menu-head">
                <span>SQL 历史</span>
                <button
                  type="button"
                  :disabled="!history.length"
                  @click="clearHistory"
                >
                  清空全部
                </button>
              </div>
              <div
                v-for="(item, index) in history"
                :key="`${index}-${item}`"
                class="history-row"
              >
                <button
                  type="button"
                  class="history-item"
                  :title="item"
                  @click="pickHistory(item)"
                >
                  {{ item }}
                </button>
                <button
                  type="button"
                  class="history-delete"
                  title="删除这条历史"
                  @click="deleteHistoryItem(item, $event)"
                >
                  删除
                </button>
              </div>
            </div>
          </div>
          <button
            v-if="!executing"
            class="btn-accent sm"
            type="button"
            :disabled="!dbSession"
            @click="executeSelectedSql"
          >
            执行
          </button>
          <button
            v-else
            class="btn-glass sm danger"
            type="button"
            :disabled="cancelRequested"
            @click="cancelSql"
          >
            {{ cancelRequested ? "取消中…" : "取消" }}
          </button>
        </div>
        <div class="sql-editor-shell" :style="{ height: `${editorHeight}px` }">
          <pre
            ref="sqlHighlightRef"
            class="sql-highlight"
            aria-hidden="true"
            v-html="highlightedSql"
          />
          <textarea
            ref="sqlEditorRef"
            v-model="sql"
            class="sql-editor"
            spellcheck="false"
            :disabled="!dbSession || executing"
            placeholder="连接数据库后输入 SQL"
            @contextmenu.prevent="openSqlContextMenu"
            @keydown.f9.prevent="executeSelectedSql"
            @keydown.ctrl.space.prevent="showCompletions = true"
            @keydown="onSqlEditorKeydown"
            @scroll="syncSqlHighlightScroll"
          />
        </div>
        <div
          class="editor-splitter"
          title="拖动调整 SQL 编辑区高度"
          @pointerdown.prevent="startEditorResize"
        />

        <div class="detail-head">
          <div class="detail-tabs">
            <button
              type="button"
              :class="{ active: detailTab === 'result' }"
              @click="detailTab = 'result'"
            >
              查询结果
            </button>
            <button
              type="button"
              :class="{ active: detailTab === 'columns' }"
              :disabled="!columns.length"
              @click="detailTab = 'columns'"
            >
              表字段
            </button>
          </div>
          <div class="detail-meta">
            <template v-if="detailTab === 'result'">
              <span v-if="result">
                {{ result.rowCount }} 行
                <template v-if="result.affectedRows !== undefined">
                  · 影响 {{ result.affectedRows }} 行
                </template>
                · {{ result.elapsedMs }} ms
              </span>
              <span v-else-if="connecting">连接数据库中…</span>
              <span v-else>执行结果</span>
            </template>
            <template v-else>
              <span v-if="activeTable"
                >{{ activeTable }} · {{ columns.length }} 个字段</span
              >
              <span v-else>表字段</span>
            </template>
          </div>
          <button
            v-if="detailTab === 'result'"
            class="btn-glass sm"
            type="button"
            :disabled="exporting"
            @click="exportResultCsv"
          >
            {{ exporting ? "导出中…" : "导出" }}
          </button>
        </div>
        <div v-if="detailTab === 'result'" class="grid-wrap">
          <table v-if="result && result.columns.length" class="data-grid">
            <thead>
              <tr>
                <th
                  v-for="column in result.columns"
                  :key="column"
                  :style="columnStyle('result', column)"
                >
                  <span>{{ column }}</span>
                  <i
                    class="col-resize"
                    aria-hidden="true"
                    @pointerdown.prevent.stop="
                      startColumnResize('result', column, $event)
                    "
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, rowIndex) in result.rows" :key="rowIndex">
                <td
                  v-for="column in result.columns"
                  :key="column"
                  :style="columnStyle('result', column)"
                  :title="formatCell(row[column])"
                >
                  {{ formatCell(row[column]) }}
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else-if="result" class="result-empty">
            执行完成，没有返回结果集。
          </div>
          <div v-else class="result-empty">
            选择左侧数据库服务并登录后即可执行 SQL。
          </div>
        </div>
        <div v-else class="grid-wrap">
          <table v-if="columns.length" class="data-grid field-grid">
            <thead>
              <tr>
                <th
                  v-for="fieldColumn in fieldTableColumns"
                  :key="fieldColumn.key"
                  :style="columnStyle('field', fieldColumn.key)"
                >
                  <span>{{ fieldColumn.label }}</span>
                  <i
                    class="col-resize"
                    aria-hidden="true"
                    @pointerdown.prevent.stop="
                      startColumnResize('field', fieldColumn.key, $event)
                    "
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="column in columns"
                :key="column.name"
                :title="columnHoverText(column)"
              >
                <td
                  v-for="fieldColumn in fieldTableColumns"
                  :key="fieldColumn.key"
                  :style="columnStyle('field', fieldColumn.key)"
                >
                  {{ fieldCellValue(column, fieldColumn.key) }}
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else class="result-empty">从左侧选择表后查看字段信息。</div>
        </div>
      </section>
    </div>

    <div
      v-if="sqlContextMenu.open"
      ref="sqlMenuWrap"
      class="sql-context-menu"
      :style="{ left: `${sqlContextMenu.x}px`, top: `${sqlContextMenu.y}px` }"
    >
      <button
        type="button"
        :disabled="!dbSession || executing"
        @click="executeSelectedSql"
      >
        执行选中 SQL
      </button>
      <button type="button" @click="copySelectedSql">复制</button>
    </div>

    <DatabaseConnectionModal
      v-if="showCredentialModal && credentialService"
      :session-id="sessionId"
      :host-id="hostId"
      :service="credentialService"
      :connection="editingCredential"
      @close="showCredentialModal = false"
      @saved="onCredentialSaved"
    />
  </div>
</template>

<style scoped>
.database {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: transparent;
}

.database.disabled {
  opacity: 0.55;
  pointer-events: none;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--glass-border);
  background: rgba(255, 255, 255, 0.03);
}

.title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.pane-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  color: var(--text-muted);
}

.pane-icon {
  width: 28px;
  height: 28px;
  border-radius: 8px;
}

.pane-icon svg {
  width: 15px;
  height: 15px;
}

.pane-icon:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--glass-border-strong);
  background: var(--glass-bg-strong);
}

.pane-icon:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.toolbar-title,
.editor-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
}

.sub {
  min-width: 0;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 500;
}

.toolbar-spacer {
  flex: 1;
}

.workbench {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: var(--left-pane-width, 420px) 7px minmax(0, 1fr);
}

.service-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  padding: 0;
}

.side-splitter {
  min-height: 0;
  border-left: 1px solid var(--glass-border);
  border-right: 1px solid var(--glass-border);
  background:
    linear-gradient(
      180deg,
      transparent 0,
      transparent calc(50% - 24px),
      var(--glass-border) calc(50% - 24px),
      var(--glass-border) calc(50% + 24px),
      transparent calc(50% + 24px)
    ),
    rgba(255, 255, 255, 0.02);
  cursor: col-resize;
}

.side-splitter:hover {
  background:
    linear-gradient(
      180deg,
      transparent 0,
      transparent calc(50% - 30px),
      var(--glass-border-strong) calc(50% - 30px),
      var(--glass-border-strong) calc(50% + 30px),
      transparent calc(50% + 30px)
    ),
    var(--accent-soft);
}

.pane-title {
  flex-shrink: 0;
  margin: 0;
  padding: 12px 12px 8px;
  font-size: 12px;
  font-weight: 700;
  color: var(--text-muted);
}

.structure-heading {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.structure-heading em {
  color: var(--text-muted);
  font-style: normal;
  font-size: 11px;
  font-weight: 500;
}

.pane-title.small {
  margin-top: 14px;
}

.pane-section {
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.service-section {
  flex: 0 0 360px;
}

.structure-section {
  flex: 1;
}

.pane-v-splitter {
  flex: 0 0 7px;
  border-top: 1px solid var(--glass-border);
  border-bottom: 1px solid var(--glass-border);
  background:
    linear-gradient(
      90deg,
      transparent 0,
      transparent calc(50% - 24px),
      var(--glass-border) calc(50% - 24px),
      var(--glass-border) calc(50% + 24px),
      transparent calc(50% + 24px)
    ),
    rgba(255, 255, 255, 0.02);
  cursor: row-resize;
}

.pane-v-splitter:hover {
  background:
    linear-gradient(
      90deg,
      transparent 0,
      transparent calc(50% - 30px),
      var(--glass-border-strong) calc(50% - 30px),
      var(--glass-border-strong) calc(50% + 30px),
      transparent calc(50% + 30px)
    ),
    var(--accent-soft);
}

.service-list,
.structure-list {
  min-height: 0;
  overflow: auto;
  padding: 0 10px 10px;
}

.service-list {
  flex: 1;
  overflow-x: auto;
}

.structure-list {
  flex: 1;
  padding-top: 2px;
}

.pane-empty,
.result-empty {
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.5;
  padding: 12px 4px;
}

.service-card {
  width: 100%;
  min-width: 360px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 112px;
  margin-bottom: 8px;
  padding: 10px;
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  background: var(--glass-bg);
  color: var(--text);
  text-align: left;
  cursor: pointer;
}

.service-card:hover,
.service-card.active {
  border-color: var(--glass-border-strong);
  background: var(--accent-soft);
}

.service-card.connected {
  border-color: rgba(74, 222, 155, 0.38);
}

.svc-main,
.svc-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.svc-main strong {
  font-size: 13px;
}

.svc-title,
.svc-right {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.svc-title strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(180, 190, 205, 0.58);
  box-shadow: 0 0 0 3px rgba(180, 190, 205, 0.08);
}

.status-dot.connected {
  background: var(--success);
  box-shadow: 0 0 0 3px rgba(74, 222, 155, 0.14);
}

.svc-main span,
.svc-meta {
  color: var(--text-muted);
  font-size: 11px;
  font-family: var(--mono);
}

.svc-meta {
  font-family: inherit;
  justify-content: flex-start;
  flex-wrap: wrap;
  gap: 7px;
}

.svc-check {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--danger);
}

.svc-check.ok {
  color: var(--success);
}

.svc-actions {
  display: grid;
  grid-template-columns: repeat(2, 34px);
  justify-content: end;
  gap: 6px;
  padding-top: 2px;
}

.svc-action {
  width: 34px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--glass-border);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
  padding: 0;
}

.svc-action svg {
  width: 15px;
  height: 15px;
}

.svc-action:hover:not(:disabled) {
  border-color: var(--glass-border-strong);
  background: var(--glass-bg-strong);
}

.svc-action:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.schema-item,
.table-item {
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--text);
  text-align: left;
  border-radius: 8px;
  min-height: 40px;
  padding: 10px 11px;
  font-size: 12px;
}

.schema-item:hover,
.schema-item.active,
.table-item:hover,
.table-item.active {
  background: var(--accent-soft);
  color: var(--accent-hover);
}

.table-list {
  margin: 6px 0 10px 10px;
  padding-left: 10px;
  border-left: 1px solid var(--glass-border);
}

.schema-node {
  margin-bottom: 8px;
}

.schema-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.schema-item.expanded {
  background: rgba(255, 255, 255, 0.04);
}

.schema-name {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.schema-item em {
  flex-shrink: 0;
  color: var(--text-muted);
  font-style: normal;
  font-size: 11px;
}

.chev {
  width: 12px;
  color: var(--text-muted);
  font-size: 11px;
}

.table-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.table-item span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.table-item em {
  flex-shrink: 0;
  color: var(--text-muted);
  font-style: normal;
  font-size: 11px;
}

.table-empty {
  padding: 10px 11px;
  color: var(--text-muted);
  font-size: 12px;
}

.query-pane {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.editor-head,
.detail-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 42px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--glass-border);
  background: rgba(255, 255, 255, 0.025);
}

.detail-head {
  min-height: 38px;
  justify-content: space-between;
}

.detail-tabs {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px;
  border: 1px solid var(--glass-border);
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.16);
}

.detail-tabs button {
  min-height: 26px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
  padding: 0 10px;
  font-size: 12px;
}

.detail-tabs button:hover:not(:disabled) {
  color: var(--text);
  background: rgba(255, 255, 255, 0.04);
}

.detail-tabs button.active {
  color: var(--text);
  background: var(--glass-bg-strong);
}

.detail-tabs button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.detail-meta {
  margin-left: auto;
  min-width: 0;
  color: var(--text-muted);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.editor-title {
  flex: 1;
}

.history-wrap,
.menu-wrap {
  position: relative;
}

.history-menu,
.snippet-menu,
.completion-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: min(460px, 70vw);
  max-height: 320px;
  overflow: auto;
  padding: 10px;
  border: 1px solid var(--glass-border);
  border-radius: 12px;
  background: color-mix(in srgb, #0b1522 92%, transparent);
  backdrop-filter: blur(16px);
  box-shadow: var(--glass-shadow);
}

.history-menu-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 4px 4px 8px;
  border-bottom: 1px solid var(--glass-border);
  color: var(--text-muted);
  font-size: 12px;
}

.history-menu-head button {
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--danger);
  padding: 4px 7px;
  font-size: 12px;
}

.history-menu-head button:hover:not(:disabled) {
  background: rgba(255, 123, 138, 0.12);
}

.history-menu-head button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.history-row {
  display: flex;
  align-items: stretch;
  gap: 6px;
}

.snippet-menu {
  width: min(520px, 78vw);
  gap: 8px;
  padding: 10px;
}

.completion-menu {
  width: min(560px, 76vw);
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 6px;
}

.history-item,
.snippet-item,
.completion-item {
  display: block;
  width: 100%;
  min-height: 38px;
  border: 0;
  background: transparent;
  color: var(--text);
  text-align: left;
  padding: 10px 12px;
  border-radius: 8px;
  font-family: var(--mono);
  font-size: 12px;
}

.history-item {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.completion-item {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-delete {
  flex-shrink: 0;
  border: 1px solid rgba(255, 123, 138, 0.22);
  border-radius: 8px;
  background: rgba(255, 123, 138, 0.08);
  color: var(--danger);
  padding: 0 9px;
  font-size: 12px;
}

.history-delete:hover {
  background: rgba(255, 123, 138, 0.16);
}

.snippet-item {
  font-family: inherit;
  min-height: 58px;
  padding: 12px 14px;
  white-space: normal;
}

.snippet-item strong,
.snippet-item span {
  display: block;
}

.snippet-item strong {
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--text);
}

.snippet-item span {
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.45;
}

.history-item:hover,
.snippet-item:hover,
.completion-item:hover {
  background: var(--accent-soft);
  color: var(--accent-hover);
}

.snippet-item:hover strong,
.snippet-item:hover span {
  color: var(--accent-hover);
}

.sql-editor-shell {
  flex: 0 0 auto;
  position: relative;
  width: 100%;
  min-height: 150px;
  border-bottom: 1px solid var(--glass-border);
  background: rgba(0, 0, 0, 0.14);
}

.sql-highlight,
.sql-editor {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  resize: none;
  border: 0;
  outline: none;
  padding: 14px;
  font-family: var(--mono);
  font-size: 13px;
  line-height: 1.55;
  white-space: pre;
  overflow: auto;
}

.sql-highlight {
  overflow: hidden;
  pointer-events: none;
  color: var(--text);
}

.sql-editor {
  z-index: 1;
  background: transparent;
  color: transparent;
  caret-color: var(--text);
}

.sql-editor::selection {
  background: rgba(88, 166, 255, 0.28);
}

.sql-editor::placeholder {
  color: var(--text-muted);
  -webkit-text-fill-color: var(--text-muted);
}

.tok-keyword {
  color: #7dd3fc;
  font-weight: 700;
}

.tok-string {
  color: #f8d477;
}

.tok-number {
  color: #a7f3d0;
}

.tok-comment {
  color: var(--text-muted);
  font-style: italic;
}

.editor-splitter {
  flex: 0 0 7px;
  border-bottom: 1px solid var(--glass-border);
  background:
    linear-gradient(
      90deg,
      transparent 0,
      transparent calc(50% - 18px),
      var(--glass-border) calc(50% - 18px),
      var(--glass-border) calc(50% + 18px),
      transparent calc(50% + 18px)
    ),
    rgba(255, 255, 255, 0.02);
  cursor: row-resize;
}

.editor-splitter:hover {
  background:
    linear-gradient(
      90deg,
      transparent 0,
      transparent calc(50% - 24px),
      var(--glass-border-strong) calc(50% - 24px),
      var(--glass-border-strong) calc(50% + 24px),
      transparent calc(50% + 24px)
    ),
    var(--accent-soft);
}

.sql-editor-shell:focus-within {
  box-shadow: inset 0 0 0 1px var(--glass-border-strong);
}

.sql-editor:disabled {
  opacity: 0.55;
}

.grid-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.data-grid {
  width: max-content;
  min-width: 100%;
  border-collapse: collapse;
  table-layout: auto;
  font-size: 12px;
}

.data-grid th,
.data-grid td {
  min-width: max-content;
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  border-right: 1px solid rgba(255, 255, 255, 0.04);
  white-space: nowrap;
}

.data-grid th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: rgba(8, 14, 22, 0.9);
  color: var(--text-muted);
  font-weight: 700;
  user-select: none;
}

.data-grid th span {
  display: inline-block;
  padding-right: 10px;
}

.data-grid td {
  font-family: var(--mono);
}

.field-grid td:last-child {
  color: var(--text-muted);
}

.col-resize {
  position: absolute;
  top: 0;
  right: -3px;
  width: 8px;
  height: 100%;
  cursor: col-resize;
  z-index: 3;
}

.col-resize::after {
  content: "";
  position: absolute;
  top: 7px;
  bottom: 7px;
  left: 3px;
  width: 1px;
  background: transparent;
}

.data-grid th:hover .col-resize::after {
  background: var(--glass-border-strong);
}

.sql-context-menu {
  position: fixed;
  z-index: 1200;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 150px;
  padding: 6px;
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  background: color-mix(in srgb, #0b1522 94%, transparent);
  backdrop-filter: blur(16px);
  box-shadow: var(--glass-shadow);
}

.sql-context-menu button {
  min-height: 34px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  text-align: left;
  padding: 0 10px;
  font-size: 12px;
}

.sql-context-menu button:hover:not(:disabled) {
  background: var(--accent-soft);
  color: var(--accent-hover);
}

.sql-context-menu button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

@media (max-width: 820px) {
  .workbench {
    grid-template-columns: 1fr;
  }

  .side-splitter {
    display: none;
  }

  .service-pane {
    max-height: 360px;
    border-right: 0;
    border-bottom: 1px solid var(--glass-border);
  }

  .service-section {
    flex-basis: 160px;
  }
}
</style>
