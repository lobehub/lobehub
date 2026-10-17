import type { LocalDatabaseEntry } from '@/libs/localDatabase';

export interface LocalDatabaseField {
  id: string;
  label: string;
  type: string;
  value: unknown;
}

export interface LocalDatabaseColumn {
  id: string;
  label: string;
}

export interface LocalDatabaseTableRow {
  entry: LocalDatabaseEntry;
  fields: LocalDatabaseField[];
  replica?: ReplicaStorageKey;
}

export interface ReplicaStorageKey {
  query: string;
  resource: string;
  scope: string;
  version: number;
}

export interface ReplicaResourceGroup {
  entryCount: number;
  name: string;
}

const FIELD_PRIORITY = new Map([
  ['key', 0],
  ['resource', 1],
  ['version', 2],
  ['scope', 3],
  ['query', 4],
  ['updatedAt', 5],
  ['id', 6],
]);

// encodeURIComponent escapes ':', so only the resource name can contain one.
const REPLICA_KEY_PATTERN = /^replica:(.+):v(\d+):([^:]*):([^:]*)$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);

const isTimestampEnvelope = (
  value: unknown,
): value is Record<string, unknown> & { data: unknown; updatedAt: number } =>
  isRecord(value) && 'data' in value && typeof value.updatedAt === 'number';

const decode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const parseReplicaStorageKey = (key: string): ReplicaStorageKey | undefined => {
  const match = REPLICA_KEY_PATTERN.exec(key);
  if (!match) return undefined;

  const [, resource, version, scope, query] = match;
  return { query: decode(query), resource, scope: decode(scope), version: Number(version) };
};

const serialize = (value: unknown, indent?: number): string => {
  const seen = new WeakSet<object>();

  try {
    const result = JSON.stringify(
      value,
      (_key, item) => {
        if (typeof item === 'bigint') return `${item}n`;
        if (typeof item === 'object' && item !== null) {
          if (seen.has(item)) return '[Circular]';
          seen.add(item);
        }
        return item;
      },
      indent,
    );

    return result ?? String(value);
  } catch (error) {
    return `[Unable to serialize: ${error instanceof Error ? error.message : String(error)}]`;
  }
};

export const getLocalDatabaseValueType = (value: unknown): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array[${value.length}]`;
  if (value instanceof Date) return 'date';
  return typeof value;
};

export const formatLocalDatabaseCellValue = (value: unknown): string => {
  if (value === null) return 'NULL';
  if (value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return serialize(value);
  return String(value);
};

export const formatLocalDatabaseFieldValue = (value: unknown): string => {
  if (value === null) return 'NULL';
  if (value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  return serialize(value, 2);
};

const createField = (id: string, label: string, value: unknown): LocalDatabaseField => ({
  id,
  label,
  type: getLocalDatabaseValueType(value),
  value,
});

const byPriority = <T>(items: T[], labelOf: (item: T) => string): T[] =>
  items
    .map((item, index) => ({ index, item }))
    .sort(
      (a, b) =>
        (FIELD_PRIORITY.get(labelOf(a.item)) ?? Number.POSITIVE_INFINITY) -
          (FIELD_PRIORITY.get(labelOf(b.item)) ?? Number.POSITIVE_INFINITY) || a.index - b.index,
    )
    .map(({ item }) => item);

const pushValueFields = (fields: LocalDatabaseField[], prefix: string, value: unknown) => {
  if (!isRecord(value)) {
    fields.push(createField(prefix, prefix, value));
    return;
  }

  for (const [name, fieldValue] of Object.entries(value)) {
    const label = FIELD_PRIORITY.has(name) && name !== 'id' ? `${prefix}.${name}` : name;
    fields.push(createField(`${prefix}.${name}`, label, fieldValue));
  }
};

export const getLocalDatabaseFields = (
  entry: LocalDatabaseEntry,
  replica?: ReplicaStorageKey,
): LocalDatabaseField[] => {
  const fields = [createField('__key', 'key', entry.key)];

  if (replica) {
    fields.push(
      createField('__replica.resource', 'resource', replica.resource),
      createField('__replica.version', 'version', replica.version),
      createField('__replica.scope', 'scope', replica.scope),
      createField('__replica.query', 'query', replica.query),
    );
  }

  const { value } = entry;

  if (isTimestampEnvelope(value)) {
    fields.push(createField('__updatedAt', 'updatedAt', new Date(value.updatedAt)));
    pushValueFields(fields, 'data', value.data);
    for (const [name, fieldValue] of Object.entries(value)) {
      if (name === 'data' || name === 'updatedAt') continue;
      fields.push(createField(`envelope.${name}`, name, fieldValue));
    }
  } else {
    pushValueFields(fields, 'value', value);
  }

  return byPriority(fields, (field) => field.label);
};

export const createLocalDatabaseTableRows = (
  entries: LocalDatabaseEntry[],
): LocalDatabaseTableRow[] =>
  entries.map((entry) => {
    const replica = parseReplicaStorageKey(entry.key);
    return { entry, fields: getLocalDatabaseFields(entry, replica), replica };
  });

export const getReplicaResourceGroups = (rows: LocalDatabaseTableRow[]): ReplicaResourceGroup[] => {
  const counts = new Map<string, number>();

  for (const { replica } of rows) {
    if (!replica) continue;
    counts.set(replica.resource, (counts.get(replica.resource) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([name, entryCount]) => ({ entryCount, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

export const filterRowsByResource = (
  rows: LocalDatabaseTableRow[],
  resource: string | null,
): LocalDatabaseTableRow[] =>
  resource ? rows.filter(({ replica }) => replica?.resource === resource) : rows;

export const getLocalDatabaseColumns = (rows: LocalDatabaseTableRow[]): LocalDatabaseColumn[] => {
  const columns = new Map<string, LocalDatabaseColumn>();

  for (const row of rows) {
    for (const field of row.fields) {
      if (!columns.has(field.id)) columns.set(field.id, { id: field.id, label: field.label });
    }
  }

  return byPriority([...columns.values()], (column) => column.label);
};

export const filterLocalDatabaseRows = (
  rows: LocalDatabaseTableRow[],
  search: string,
): LocalDatabaseTableRow[] => {
  const term = search.trim().toLowerCase();
  if (!term) return rows;

  return rows.filter(({ fields }) =>
    fields.some(
      ({ label, value }) =>
        label.toLowerCase().includes(term) ||
        formatLocalDatabaseCellValue(value).toLowerCase().includes(term),
    ),
  );
};

export const filterLocalDatabaseFields = (
  fields: LocalDatabaseField[],
  search: string,
): LocalDatabaseField[] => {
  const term = search.trim().toLowerCase();
  if (!term) return fields;

  return fields.filter(
    ({ label, type, value }) =>
      label.toLowerCase().includes(term) ||
      type.toLowerCase().includes(term) ||
      formatLocalDatabaseCellValue(value).toLowerCase().includes(term),
  );
};
