import type {
  ProjectionFragment,
  ProjectionIndex,
  ProjectionKind,
  ProjectionRecord,
  ProjectionSnapshot,
  ProjectionSource,
} from '@lobechat/types';

import type { ProjectionStoreState } from '@/projection/core/initialState';
import type { ManagedProjection, ProjectionDevtoolEditTarget } from '@/projection/devtools';
import { projectionDevtoolRecordKey } from '@/projection/devtools/identity';

export type ProjectionTableId = ProjectionKind | 'homeIndexes' | 'homeSnapshots';

interface ProjectionTableDefinitionBase {
  id: ProjectionTableId;
  label: string;
}

interface ProjectionRecordTableDefinition extends ProjectionTableDefinitionBase {
  contentColumn: 'fragments';
  identityColumn: 'id';
  recordKind: ProjectionKind;
  source: 'records';
}

interface ProjectionValueTableDefinition extends ProjectionTableDefinitionBase {
  contentColumn: 'data';
  identityColumn: 'key';
  source: 'indexes' | 'snapshots';
}

export type ProjectionTableDefinition =
  ProjectionRecordTableDefinition | ProjectionValueTableDefinition;

export type ProjectionTableSummary = ProjectionTableDefinition & {
  rowCount: number;
};

export interface ProjectionTableRow {
  fieldNames: string[];
  identity: string;
  latestObservedAt?: number;
  projection?: ManagedProjection;
  rowKey: string;
  rowType: 'index' | 'record' | 'snapshot';
  scope: string;
  sources: ProjectionSource[];
  value: ProjectionIndex | ProjectionRecord | ProjectionSnapshot;
}

export type ProjectionTableColumnKind = 'field' | 'identity' | 'metadata';

export interface ProjectionTableColumn {
  fieldName?: string;
  id: string;
  kind: ProjectionTableColumnKind;
  label: string;
  width: number;
}

export interface ProjectionTableCell {
  column: ProjectionTableColumn;
  displayValue: string;
  editTarget?: ProjectionDevtoolEditTarget;
  key: string;
  title: string;
  value: unknown;
}

export const PROJECTION_TABLES: readonly ProjectionTableDefinition[] = [
  {
    contentColumn: 'fragments',
    id: 'agent',
    identityColumn: 'id',
    label: 'agents',
    recordKind: 'agent',
    source: 'records',
  },
  {
    contentColumn: 'fragments',
    id: 'chatGroup',
    identityColumn: 'id',
    label: 'chat_groups',
    recordKind: 'chatGroup',
    source: 'records',
  },
  {
    contentColumn: 'fragments',
    id: 'topic',
    identityColumn: 'id',
    label: 'topics',
    recordKind: 'topic',
    source: 'records',
  },
  {
    contentColumn: 'fragments',
    id: 'task',
    identityColumn: 'id',
    label: 'tasks',
    recordKind: 'task',
    source: 'records',
  },
  {
    contentColumn: 'fragments',
    id: 'brief',
    identityColumn: 'id',
    label: 'briefs',
    recordKind: 'brief',
    source: 'records',
  },
  {
    contentColumn: 'data',
    id: 'homeIndexes',
    identityColumn: 'key',
    label: 'home_indexes',
    source: 'indexes',
  },
  {
    contentColumn: 'data',
    id: 'homeSnapshots',
    identityColumn: 'key',
    label: 'home_snapshots',
    source: 'snapshots',
  },
];

const getFragments = (record: ProjectionRecord): ProjectionFragment<unknown>[] =>
  Object.values(record.fragments as Record<string, ProjectionFragment<unknown> | undefined>).filter(
    (fragment): fragment is ProjectionFragment<unknown> => Boolean(fragment),
  );

const serializeForSearch = (value: ProjectionTableRow['value']): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
};

const definedValueCount = (values: Record<string, unknown | undefined>): number =>
  Object.values(values).filter((value) => value !== undefined).length;

const getTableRowCount = (
  scopes: ProjectionStoreState['scopes'],
  table: ProjectionTableDefinition,
): number =>
  Object.values(scopes).reduce((count, state) => {
    if (table.source === 'records') {
      return count + Object.keys(state.records[table.recordKind]).length;
    }
    if (table.source === 'indexes') return count + definedValueCount(state.indexes);
    return count + definedValueCount(state.snapshots);
  }, 0);

export const createProjectionTableSummaries = (
  scopes: ProjectionStoreState['scopes'],
): ProjectionTableSummary[] =>
  PROJECTION_TABLES.map((table) => ({ ...table, rowCount: getTableRowCount(scopes, table) }));

export const filterProjectionTableSummaries = (
  tables: ProjectionTableSummary[],
  search: string,
): ProjectionTableSummary[] => {
  const normalize = (value: string) =>
    value
      .replaceAll('_', ' ')
      .replaceAll(/([a-z\d])([A-Z])/g, '$1 $2')
      .toLowerCase();
  const term = normalize(search.trim());
  if (!term) return tables;

  return tables.filter(({ id, label }) => normalize(`${id} ${label}`).includes(term));
};

const createRecordRows = (
  rows: ProjectionTableRow[],
  scope: string,
  records: Record<string, ProjectionRecord>,
) => {
  for (const record of Object.values(records)) {
    const fragments = getFragments(record);
    const observations = [
      ...fragments.map(({ observedAt }) => observedAt),
      ...(record.tombstoneAt === undefined ? [] : [record.tombstoneAt]),
    ];
    const projection: ManagedProjection = {
      entryKey: projectionDevtoolRecordKey(scope, record.kind, record.id),
      record,
      scope,
    };

    rows.push({
      fieldNames: Object.keys(record.fragments).sort((a, b) => a.localeCompare(b)),
      identity: record.id,
      latestObservedAt: observations.length > 0 ? Math.max(...observations) : undefined,
      projection,
      rowKey: projection.entryKey,
      rowType: 'record',
      scope,
      sources: [...new Set(fragments.map(({ source }) => source))].sort((a, b) =>
        a.localeCompare(b),
      ),
      value: record,
    });
  }
};

const getValueFieldNames = (value: ProjectionIndex | ProjectionSnapshot): string[] =>
  Object.keys(value)
    .filter((key) => key !== 'key' && key !== 'observedAt' && key !== 'source')
    .sort((a, b) => a.localeCompare(b));

const createValueRows = (
  rows: ProjectionTableRow[],
  scope: string,
  rowType: 'index' | 'snapshot',
  values: Array<ProjectionIndex | ProjectionSnapshot | undefined>,
) => {
  for (const value of values) {
    if (!value) continue;
    rows.push({
      fieldNames: getValueFieldNames(value),
      identity: value.key,
      latestObservedAt: value.observedAt,
      rowKey: projectionDevtoolRecordKey(scope, rowType, value.key),
      rowType,
      scope,
      sources: [value.source],
      value,
    });
  }
};

const FIXED_COLUMNS = {
  observedAt: {
    id: 'observedAt',
    kind: 'metadata',
    label: 'observed_at',
    width: 220,
  },
  scope: { id: 'scope', kind: 'identity', label: 'scope', width: 280 },
  source: { id: 'source', kind: 'metadata', label: 'source', width: 140 },
} as const satisfies Record<string, ProjectionTableColumn>;

export const createProjectionTableColumns = (
  rows: ProjectionTableRow[],
  table: ProjectionTableDefinition | null,
): ProjectionTableColumn[] => {
  const fieldNames = [
    ...new Set(rows.flatMap(({ fieldNames: currentFieldNames }) => currentFieldNames)),
  ].sort((a, b) => a.localeCompare(b));

  return [
    FIXED_COLUMNS.scope,
    {
      id: 'identity',
      kind: 'identity',
      label: table?.identityColumn ?? 'id',
      width: 220,
    },
    ...fieldNames.map((fieldName): ProjectionTableColumn => ({
      fieldName,
      id: `field:${fieldName}`,
      kind: 'field',
      label: fieldName,
      width: 260,
    })),
    FIXED_COLUMNS.source,
    FIXED_COLUMNS.observedAt,
  ];
};

const formatTimestamp = (timestamp: number | undefined): string =>
  timestamp === undefined ? '—' : new Date(timestamp).toISOString();

export const serializeProjectionCellValue = (value: unknown, pretty = false): string => {
  if (value === undefined || value === null) return 'NULL';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;

  try {
    return JSON.stringify(value, null, pretty ? 2 : undefined) ?? 'NULL';
  } catch {
    return String(value);
  }
};

const getFieldValue = (row: ProjectionTableRow, fieldName: string): unknown => {
  if (row.rowType === 'record') {
    const fragments = row.projection?.record.fragments as
      Record<string, ProjectionFragment<unknown> | undefined> | undefined;
    return fragments?.[fieldName]?.data;
  }

  return (row.value as unknown as Record<string, unknown>)[fieldName];
};

const getCellEditTarget = (
  row: ProjectionTableRow,
  column: ProjectionTableColumn,
): ProjectionDevtoolEditTarget | undefined => {
  if (column.kind !== 'field' || !column.fieldName) return undefined;
  if (getFieldValue(row, column.fieldName) === undefined) return undefined;

  if (row.rowType === 'record') {
    if (!row.projection) return undefined;
    return {
      fragmentName: column.fieldName,
      projection: row.projection,
      type: 'fragment',
    };
  }

  return {
    fieldName: column.fieldName,
    key: row.identity,
    scope: row.scope,
    type: row.rowType,
  };
};

export const createProjectionTableCell = (
  row: ProjectionTableRow,
  column: ProjectionTableColumn,
): ProjectionTableCell => {
  let value: unknown;
  if (column.id === 'scope') value = row.scope;
  else if (column.id === 'identity') value = row.identity;
  else if (column.id === 'source') value = row.sources.join(', ') || undefined;
  else if (column.id === 'observedAt') value = formatTimestamp(row.latestObservedAt);
  else value = column.fieldName ? getFieldValue(row, column.fieldName) : undefined;

  const displayValue = serializeProjectionCellValue(value);
  return {
    column,
    displayValue,
    editTarget: getCellEditTarget(row, column),
    key: `${row.rowKey}:${column.id}`,
    title: serializeProjectionCellValue(value, true),
    value,
  };
};

export const createProjectionTableRows = (
  scopes: ProjectionStoreState['scopes'],
  tableId: ProjectionTableId | null,
): ProjectionTableRow[] => {
  const table = PROJECTION_TABLES.find(({ id }) => id === tableId);
  if (!table) return [];

  const rows: ProjectionTableRow[] = [];
  for (const [scope, state] of Object.entries(scopes)) {
    if (table.source === 'records') {
      createRecordRows(
        rows,
        scope,
        state.records[table.recordKind] as Record<string, ProjectionRecord>,
      );
      continue;
    }
    if (table.source === 'indexes') {
      createValueRows(rows, scope, 'index', Object.values(state.indexes));
      continue;
    }
    createValueRows(rows, scope, 'snapshot', Object.values(state.snapshots));
  }

  return rows.sort(
    (a, b) => a.scope.localeCompare(b.scope) || a.identity.localeCompare(b.identity),
  );
};

export const filterProjectionTableRows = (
  rows: ProjectionTableRow[],
  search: string,
): ProjectionTableRow[] => {
  const term = search.trim().toLowerCase();
  if (!term) return rows;

  return rows.filter(({ fieldNames, identity, scope, sources, value }) =>
    [scope, identity, ...fieldNames, ...sources, serializeForSearch(value)]
      .join(' ')
      .toLowerCase()
      .includes(term),
  );
};
