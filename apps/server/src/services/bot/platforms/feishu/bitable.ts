import type {
  AddBitableRecordsParams,
  AddBitableRecordsState,
  BitableFieldSpec,
  BitableFieldType,
  BitableIssue,
  BitableRecord,
  CreateBitableParams,
  CreateBitableState,
} from '@lobechat/builtin-tool-message/executionRuntime';
import type { LarkApiClient } from '@lobechat/chat-adapter-feishu';
import { parseLarkDocUrl } from '@lobechat/chat-adapter-feishu';

/**
 * Bitable (多维表格) operations for the `lobe-message` tool, run on the bot's
 * own app credentials — the App Secret never leaves the server, so the model
 * never has to ask the user for one or for a separate CLI authorization.
 *
 * A Bitable created this way is owned by the app; `createBitable` therefore
 * adds the requested people as collaborators in the same call.
 */

/** Feishu's numeric field types for the column types the tool exposes. */
export const BITABLE_FIELD_TYPE_CODES: Record<BitableFieldType, number> = {
  checkbox: 7,
  date: 5,
  multiSelect: 4,
  number: 2,
  person: 11,
  singleSelect: 3,
  text: 1,
  url: 15,
};

/** Feishu caps `records/batch_create` at 500 rows per request. */
export const BITABLE_RECORD_BATCH_SIZE = 500;

const MAX_BITABLE_FIELDS = 100;

/**
 * Bitable API failures with an operator-side fix. Scope violations already
 * name the scope (`LarkApiClient.describeError`), so this only covers codes
 * whose bare message does not say what to do.
 *
 * @see https://open.feishu.cn/document/server-docs/docs/bitable-v1/bitable-overview
 */
const BITABLE_ERROR_HINTS: Record<string, string> = {
  '1254040': 'the Bitable app token is wrong — pass the URL exactly as it appears in the chat',
  '1254041': 'the table does not exist — omit `tableId` to use the first table',
  '1254045': 'a column name does not exist in this table',
  '1254302':
    'the app cannot edit this Bitable. Its owner must add the app with 可管理 access (多维表格右上角「…」→「更多」→「添加文档应用」), or the Bitable must be one the bot created',
  '99991672':
    'the app lacks the Bitable scope. Enable 「查看、评论、编辑和管理多维表格」(`bitable:app`) under 权限管理 in the developer console, then create and publish a new app version',
};

const COLLABORATOR_ERROR_HINTS: Record<string, string> = {
  '1063002':
    'the app may not share this Bitable — it must own it or hold 可管理 (full_access) on it (「…」→「更多」→「添加文档应用」)',
  '99991672':
    'the app lacks the permission-member scope. Enable 「添加、修改、移除云文档协作者」(`docs:permission.member:create`) under 权限管理, then create and publish a new app version',
};

const withHint = (error: unknown, hints: Record<string, string>): Error => {
  const message = error instanceof Error ? error.message : String(error);
  const code = Object.keys(hints).find((c) => message.includes(c));
  if (!code) return error instanceof Error ? error : new Error(message);
  return new Error(`${message} — ${hints[code]}.`);
};

const toFieldDefinition = (field: BitableFieldSpec) => {
  const type = BITABLE_FIELD_TYPE_CODES[field.type];
  if (!type) {
    throw new Error(
      `Column "${field.name}" has unsupported type "${field.type}". Use one of: ${Object.keys(BITABLE_FIELD_TYPE_CODES).join(', ')}`,
    );
  }

  const definition: { field_name: string; property?: Record<string, unknown>; type: number } = {
    field_name: field.name.trim(),
    type,
  };
  if ((field.type === 'singleSelect' || field.type === 'multiSelect') && field.options?.length) {
    definition.property = { options: field.options.map((name) => ({ name })) };
  } else if (field.type === 'date') {
    definition.property = { auto_fill: false, date_formatter: 'yyyy/MM/dd' };
  } else if (field.type === 'person') {
    definition.property = { multiple: true };
  }
  return definition;
};

/**
 * Column types Feishu accepts for a table's first (primary / index) column.
 * Of the types the tool exposes that is text, number, date and url.
 */
const PRIMARY_FIELD_TYPES = new Set<BitableFieldType>(['text', 'number', 'date', 'url']);

const validateFields = (fields: BitableFieldSpec[]) => {
  const primary = fields[0];
  if (primary && !PRIMARY_FIELD_TYPES.has(primary.type)) {
    throw new Error(
      `The first column "${primary.name}" is the primary column and cannot be ${primary.type}; make it one of ${[...PRIMARY_FIELD_TYPES].join(', ')} (usually a text column such as the task title)`,
    );
  }
  if (fields.length > MAX_BITABLE_FIELDS) {
    throw new Error(`A table can have at most ${MAX_BITABLE_FIELDS} columns`);
  }
  const seen = new Set<string>();
  for (const field of fields) {
    const name = field.name?.trim();
    if (!name) throw new Error('Every column needs a non-empty `name`');
    if (seen.has(name)) throw new Error(`Duplicate column name "${name}"`);
    seen.add(name);
  }
};

const toDateMillis = (column: string, value: unknown): number => {
  if (typeof value === 'number') {
    // Numbers are milliseconds per the tool contract. Only a value of at most
    // 10 digits is read as Unix seconds: as milliseconds it would fall before
    // April 1970, while as seconds it covers every date up to 2286.
    return Math.abs(value) < 1e10 ? value * 1000 : value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) return toDateMillis(column, Number(trimmed));
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) return parsed;
  }
  throw new Error(
    `Column "${column}" is a date column; "${String(value)}" is not a date. Use "YYYY-MM-DD" or a millisecond timestamp`,
  );
};

const toStringList = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value])
    .map((item) => (typeof item === 'string' ? item.trim() : String(item)))
    .filter(Boolean);

/**
 * Convert one model-supplied cell to the wire shape of its column's Feishu
 * type. Types the tool does not create (formula, attachment, …) pass
 * through untouched so a hand-built table still accepts raw values.
 */
export const toBitableCellValue = (column: string, typeCode: number, value: unknown): unknown => {
  if (value === null || value === undefined) return value;

  switch (typeCode) {
    case BITABLE_FIELD_TYPE_CODES.text:
    case BITABLE_FIELD_TYPE_CODES.singleSelect: {
      return typeof value === 'string' ? value : JSON.stringify(value);
    }
    case BITABLE_FIELD_TYPE_CODES.number: {
      const number = typeof value === 'number' ? value : Number(String(value).trim());
      if (Number.isNaN(number)) {
        throw new Error(
          `Column "${column}" is a number column; "${String(value)}" is not a number`,
        );
      }
      return number;
    }
    case BITABLE_FIELD_TYPE_CODES.multiSelect: {
      return toStringList(value);
    }
    case BITABLE_FIELD_TYPE_CODES.date: {
      return toDateMillis(column, value);
    }
    case BITABLE_FIELD_TYPE_CODES.checkbox: {
      if (typeof value === 'boolean') return value;
      return ['true', '1', 'yes', 'y', '是', '已完成', 'done', '✓', '✅'].includes(
        String(value).trim().toLowerCase(),
      );
    }
    case BITABLE_FIELD_TYPE_CODES.person: {
      const items = Array.isArray(value) ? value : [value];
      return items
        .map((item) =>
          typeof item === 'object' && item !== null && 'id' in item
            ? String((item as { id: unknown }).id)
            : String(item).trim(),
        )
        .filter(Boolean)
        .map((id) => ({ id }));
    }
    case BITABLE_FIELD_TYPE_CODES.url: {
      if (typeof value === 'object') return value;
      const link = String(value).trim();
      return { link, text: link };
    }
    default: {
      return value;
    }
  }
};

/**
 * Map rows keyed by column name to Feishu's wire values. Unknown columns fail
 * the whole batch up front with the real column list, instead of Feishu's
 * opaque `FieldNameNotFound`.
 */
export const toBitableRecords = (
  records: BitableRecord[],
  columnTypes: Map<string, number>,
): Array<Record<string, unknown>> =>
  records.map((record, index) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new Error(`Record #${index + 1} must be an object keyed by column name`);
    }
    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      // Column names are created trimmed, so a key with stray whitespace
      // still matches; an exact name wins for hand-built tables.
      const column = columnTypes.has(key) ? key : key.trim();
      const typeCode = columnTypes.get(column);
      if (typeCode === undefined) {
        throw new Error(
          `Record #${index + 1} has unknown column "${key}". Columns are: ${[...columnTypes.keys()].join(', ')}`,
        );
      }
      if (value === null || value === undefined || value === '') continue;
      fields[column] = toBitableCellValue(column, typeCode, value);
    }
    return fields;
  });

/**
 * A batch failed after earlier batches were committed. Carries the ids that
 * did land so callers report partial progress instead of inviting a retry
 * that would duplicate them.
 */
class PartialRecordWriteError extends Error {
  constructor(
    readonly recordIds: string[],
    readonly total: number,
    cause: unknown,
  ) {
    super(
      recordIds.length > 0
        ? `${withHint(cause, BITABLE_ERROR_HINTS).message} — ${recordIds.length} of ${total} rows were already written; retry only rows #${recordIds.length + 1}–#${total}, not the earlier ones`
        : withHint(cause, BITABLE_ERROR_HINTS).message,
    );
  }
}

const insertRecords = async (
  api: LarkApiClient,
  appToken: string,
  tableId: string,
  rows: Array<Record<string, unknown>>,
): Promise<string[]> => {
  const recordIds: string[] = [];
  for (let start = 0; start < rows.length; start += BITABLE_RECORD_BATCH_SIZE) {
    const batch = rows.slice(start, start + BITABLE_RECORD_BATCH_SIZE);
    try {
      const result = await api.batchCreateBitableRecords(appToken, tableId, batch);
      recordIds.push(...result.recordIds);
    } catch (error) {
      // Batches are atomic on Feishu's side, so everything before `start`
      // is committed and everything from it on is not.
      throw new PartialRecordWriteError(recordIds, rows.length, error);
    }
  }
  return recordIds;
};

export const createBitable = async (
  api: LarkApiClient,
  params: CreateBitableParams,
  platform: string,
): Promise<CreateBitableState> => {
  const name = params.name?.trim();
  if (!name) throw new Error('createBitable needs a `name`');
  if (!params.fields?.length)
    throw new Error('createBitable needs at least one column in `fields`');
  validateFields(params.fields);
  const fieldDefinitions = params.fields.map(toFieldDefinition);

  const app = await api
    .createBitableApp({ folderToken: params.folderToken, name })
    .catch((error) => {
      throw withHint(error, BITABLE_ERROR_HINTS);
    });
  if (!app.appToken) throw new Error('Feishu did not return an app token for the new Bitable');

  const table = await api
    .createBitableTable(app.appToken, {
      fields: fieldDefinitions,
      name: params.tableName?.trim() || name,
    })
    .catch((error) => {
      const explained = withHint(error, BITABLE_ERROR_HINTS);
      throw new Error(
        `The Bitable was created (${app.url ?? app.appToken}) but its table could not be: ${explained.message}`,
      );
    });

  // A new Bitable ships with an empty default table ("数据表" with stock
  // columns); drop it so the link opens straight onto the table we built.
  // Cosmetic, so a failure is ignored.
  if (app.defaultTableId && app.defaultTableId !== table.tableId) {
    await api.deleteBitableTable(app.appToken, app.defaultTableId).catch(() => undefined);
  }

  const issues: BitableIssue[] = [];

  let recordIds: string[] = [];
  if (params.records?.length) {
    const columnTypes = new Map(fieldDefinitions.map((field) => [field.field_name, field.type]));
    try {
      recordIds = await insertRecords(
        api,
        app.appToken,
        table.tableId,
        toBitableRecords(params.records, columnTypes),
      );
    } catch (error) {
      if (error instanceof PartialRecordWriteError) recordIds = error.recordIds;
      issues.push({
        error: `${error instanceof PartialRecordWriteError ? error.message : withHint(error, BITABLE_ERROR_HINTS).message} — the table exists; retry the unwritten rows with addBitableRecords`,
        target: 'records',
      });
    }
  }

  // Sharing is per person so one bad open_id does not hide the link from
  // everyone else; each failure is reported for the model to relay.
  const collaborators: string[] = [];
  const seen = new Set<string>();
  for (const collaborator of params.collaborators ?? []) {
    const openId = collaborator?.openId?.trim();
    if (!openId || seen.has(openId)) continue;
    seen.add(openId);
    try {
      await api.addDriveCollaborator(app.appToken, 'bitable', {
        openId,
        perm: collaborator.perm ?? 'full_access',
      });
      collaborators.push(openId);
    } catch (error) {
      issues.push({ error: withHint(error, COLLABORATOR_ERROR_HINTS).message, target: openId });
    }
  }

  return {
    appToken: app.appToken,
    collaborators,
    issues: issues.length > 0 ? issues : undefined,
    name: app.name ?? name,
    platform,
    recordIds,
    tableId: table.tableId,
    url: app.url,
  };
};

/**
 * Which Bitable (and optionally which table) an `addBitableRecords` call
 * targets. `/base/<token>?table=<id>` carries both; a wiki link wraps a
 * Bitable as its object and is resolved through the wiki API.
 */
const resolveBitableTarget = async (
  api: LarkApiClient,
  params: AddBitableRecordsParams,
): Promise<{ appToken: string; tableId?: string }> => {
  if (params.url) {
    const link = parseLarkDocUrl(params.url);
    if (!link) {
      throw new Error(
        `"${params.url}" is not a Feishu/Lark Bitable link. Expected https://<tenant>.feishu.cn/base/<token>`,
      );
    }
    let tableFromUrl: string | undefined;
    try {
      tableFromUrl = new URL(params.url.trim()).searchParams.get('table') ?? undefined;
    } catch {
      tableFromUrl = undefined;
    }
    const tableId = params.tableId || tableFromUrl;

    if (link.kind === 'base') return { appToken: link.token, tableId };
    if (link.kind === 'wiki') {
      const node = await api.getWikiNode(link.token);
      if (node.objType !== 'bitable' || !node.objToken) {
        throw new Error(
          `Wiki node ${link.token} wraps a "${node.objType ?? 'unknown'}" object, not a Bitable`,
        );
      }
      return { appToken: node.objToken, tableId };
    }
    throw new Error(`"${params.url}" is a ${link.kind} link, not a Bitable (/base/) link`);
  }
  if (params.appToken) return { appToken: params.appToken, tableId: params.tableId };
  throw new Error('addBitableRecords needs the Bitable `url` (preferred) or its `appToken`');
};

export const addBitableRecords = async (
  api: LarkApiClient,
  params: AddBitableRecordsParams,
  platform: string,
): Promise<AddBitableRecordsState> => {
  if (!params.records?.length) throw new Error('addBitableRecords needs at least one record');

  try {
    const target = await resolveBitableTarget(api, params);
    let tableId = target.tableId;
    if (!tableId) {
      const tables = await api.listBitableTables(target.appToken);
      tableId = tables[0]?.tableId;
      if (!tableId) throw new Error(`Bitable ${target.appToken} has no tables`);
    }

    const fields = await api.listBitableFields(target.appToken, tableId);
    const columnTypes = new Map(fields.map((field) => [field.fieldName, field.type]));
    const recordIds = await insertRecords(
      api,
      target.appToken,
      tableId,
      toBitableRecords(params.records, columnTypes),
    );

    return { appToken: target.appToken, platform, recordIds, tableId };
  } catch (error) {
    if (error instanceof PartialRecordWriteError) throw error;
    throw withHint(error, BITABLE_ERROR_HINTS);
  }
};
