import type { ReplicaDevtoolsEntry } from '@/libs/replica/devtools';

export interface ReplicaResourceSummary {
  entryCount: number;
  name: string;
  namespace: string;
  paged: boolean;
  pendingCount: number;
  persisted: boolean;
  scope: string | undefined;
  version: number;
}

export interface ReplicaEntryRow {
  data: unknown;
  hasBase: boolean;
  key: string;
  params: unknown;
  pending: number;
  query: string | undefined;
  source: string;
  updatedAt: Date | undefined;
}

const DATE_TAG = '$date';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);

export const summarizeReplicaResource = (entry: ReplicaDevtoolsEntry): ReplicaResourceSummary => {
  const { resource } = entry;
  const state = entry.state();
  const metas = Object.values(state?.entries ?? {});

  return {
    entryCount: entry.keys().length,
    name: resource.name,
    namespace: resource.namespace,
    paged: Boolean(resource.paging),
    pendingCount: metas.reduce((total, meta) => total + meta.pending.length, 0),
    persisted: resource.persisted,
    scope: state?.scope,
    version: resource.version,
  };
};

export const createReplicaEntryRows = (entry: ReplicaDevtoolsEntry): ReplicaEntryRow[] => {
  const metas = entry.state()?.entries ?? {};

  return entry
    .keys()
    .map((key) => {
      const meta = metas[key];
      return {
        data: entry.read(key),
        hasBase: meta?.base !== undefined,
        key,
        params: meta?.params,
        pending: meta?.pending.length ?? 0,
        query: meta?.query,
        source: meta?.source ?? '—',
        updatedAt: meta?.updatedAt ? new Date(meta.updatedAt) : undefined,
      };
    })
    .sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0));
};

export const filterReplicaResources = (
  resources: ReplicaResourceSummary[],
  search: string,
): ReplicaResourceSummary[] => {
  const term = search.trim().toLowerCase();
  return term ? resources.filter(({ name }) => name.toLowerCase().includes(term)) : resources;
};

export const filterReplicaEntryRows = (
  rows: ReplicaEntryRow[],
  search: string,
): ReplicaEntryRow[] => {
  const term = search.trim().toLowerCase();
  if (!term) return rows;

  return rows.filter(({ key, query, source }) =>
    [key, query ?? '', source].some((text) => text.toLowerCase().includes(term)),
  );
};

export const describeReplicaValue = (value: unknown): string => {
  if (value === undefined) return '—';
  if (value === null) return 'null';
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return `array[${value.length}]`;
  if (isRecord(value)) {
    if (Array.isArray(value.items)) return `page · ${value.items.length} items`;
    return `object{${Object.keys(value).length}}`;
  }
  if (typeof value === 'string') return value.length > 80 ? `${value.slice(0, 80)}…` : value;
  return String(value);
};

// Dates are tagged instead of left to toJSON so an edit round-trips them as
// Date objects; selectors call date methods on these fields.
export const serializeReplicaDraft = (value: unknown): string =>
  JSON.stringify(
    value,
    function (this: Record<string, unknown>, key, item) {
      const raw = this[key];
      if (raw instanceof Date) return { [DATE_TAG]: raw.toISOString() };
      return item;
    },
    2,
  ) ?? 'null';

export const parseReplicaDraft = (text: string): unknown =>
  JSON.parse(text, (_key, item) =>
    isRecord(item) && Object.keys(item).length === 1 && typeof item[DATE_TAG] === 'string'
      ? new Date(item[DATE_TAG])
      : item,
  );
