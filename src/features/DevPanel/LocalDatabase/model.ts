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
}

const FIELD_PRIORITY = new Map([
  ['key', 0],
  ['id', 1],
  ['kind', 2],
  ['schemaVersion', 3],
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);

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

const sortFields = (fields: LocalDatabaseField[]): LocalDatabaseField[] =>
  fields
    .map((field, index) => ({ field, index }))
    .sort(
      (a, b) =>
        (FIELD_PRIORITY.get(a.field.label) ?? Number.POSITIVE_INFINITY) -
          (FIELD_PRIORITY.get(b.field.label) ?? Number.POSITIVE_INFINITY) || a.index - b.index,
    )
    .map(({ field }) => field);

export const getLocalDatabaseFields = (entry: LocalDatabaseEntry): LocalDatabaseField[] => {
  const fields = [createField('__key', 'key', entry.key)];
  const value = entry.value;

  if (isRecord(value) && 'schemaVersion' in value && 'value' in value) {
    const persistedValue = value.value;

    if (isRecord(persistedValue)) {
      for (const [name, fieldValue] of Object.entries(persistedValue)) {
        fields.push(createField(`value.${name}`, name === 'key' ? 'value.key' : name, fieldValue));
      }
    } else {
      fields.push(createField('value', 'value', persistedValue));
    }

    fields.push(createField('schemaVersion', 'schemaVersion', value.schemaVersion));
    for (const [name, fieldValue] of Object.entries(value)) {
      if (name === 'schemaVersion' || name === 'value') continue;
      fields.push(createField(`envelope.${name}`, name, fieldValue));
    }
  } else if (isRecord(value)) {
    for (const [name, fieldValue] of Object.entries(value)) {
      fields.push(createField(`value.${name}`, name, fieldValue));
    }
  } else {
    fields.push(createField('value', 'value', value));
  }

  return sortFields(fields);
};

export const createLocalDatabaseTableRows = (
  entries: LocalDatabaseEntry[],
): LocalDatabaseTableRow[] =>
  entries.map((entry) => ({ entry, fields: getLocalDatabaseFields(entry) }));

export const getLocalDatabaseColumns = (rows: LocalDatabaseTableRow[]): LocalDatabaseColumn[] => {
  const columns = new Map<string, LocalDatabaseColumn>();

  for (const row of rows) {
    for (const field of row.fields) {
      if (!columns.has(field.id)) columns.set(field.id, { id: field.id, label: field.label });
    }
  }

  return [...columns.values()]
    .map((column, index) => ({ column, index }))
    .sort(
      (a, b) =>
        (FIELD_PRIORITY.get(a.column.label) ?? Number.POSITIVE_INFINITY) -
          (FIELD_PRIORITY.get(b.column.label) ?? Number.POSITIVE_INFINITY) || a.index - b.index,
    )
    .map(({ column }) => column);
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
