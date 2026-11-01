import { isRecord } from '@lobechat/utils/object';
import { safeParseJSON } from '@lobechat/utils/safeParseJSON';

import { parseToolName, staticLabelFor } from '../../Inspector/Linear/labels';

const PRIORITY_LABEL: Record<number, string> = {
  0: 'None',
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
};

const ENTITY_ID_PREFIX = /^(issue|project|document|initiative|milestone|team|user|cycle):(.+)$/iu;
const FIELD_KEYS = [
  'id',
  'title',
  'name',
  'state',
  'status',
  'team',
  'project',
  'assignee',
  'cycle',
  'milestone',
  'priority',
  'parentId',
  'query',
  'url',
] as const;
// updatedAt is pulled out of the generic field grid and rendered as a relative
// timestamp on the entity header instead (see LinearEntity below). createdAt is
// intentionally dropped — it adds noise without signalling recency.
const ENTITY_FIELD_KEYS = [
  'state',
  'status',
  'team',
  'project',
  'assignee',
  'cycle',
  'milestone',
  'priority',
  'parentId',
] as const;
const RESULT_ARRAY_KEYS = [
  'issues',
  'items',
  'nodes',
  'results',
  'documents',
  'projects',
  'comments',
  'users',
  'teams',
] as const;

export interface LinearField {
  key: string;
  label: string;
  value: string;
}

export interface LinearLink {
  title: string;
  url: string;
}

export interface LinearEntity {
  description?: string;
  fields: LinearField[];
  id?: string;
  links: LinearLink[];
  state?: string;
  title?: string;
  /** Raw ISO last-update timestamp; rendered as relative time on the header. */
  updatedAt?: string;
  url?: string;
}

// A bare UUID (e.g. a team/comment internal id) carries no meaning for the
// reader; suppress it when the entity already has a human-readable title. Linear
// human ids like `LIN-123` never match this shape, so they stay visible.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export const isUuidLike = (value: string): boolean => UUID_PATTERN.test(value);

export interface LinearRenderModel {
  actionLabel: string;
  /**
   * Collection key (e.g. `comments`) when the result is a list wrapper that
   * unwrapped to an empty array — drives the "no results" empty state instead of
   * dumping raw JSON.
   */
  emptyCollectionKey?: string;
  errorText?: string;
  rawResultJson?: string;
  requestFields: LinearField[];
  requestLinks: LinearLink[];
  resultEntities: LinearEntity[];
  resultText?: string;
}

const toLabel = (key: string) =>
  key
    .replaceAll(/([A-Z])/g, ' $1')
    .replace(/^./u, (char) => char.toUpperCase())
    .trim();

const normalizeId = (value: string) => value.replace(ENTITY_ID_PREFIX, '$2');

const trimString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const stringifyUnknown = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (value === undefined || value === null) return '';

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const readDisplayString = (value: unknown, key?: string): string | undefined => {
  const stringValue = trimString(value);
  if (stringValue) return key === 'id' ? normalizeId(stringValue) : stringValue;

  if (typeof value === 'number') {
    if (key === 'priority') return PRIORITY_LABEL[value] ?? String(value);
    return String(value);
  }

  if (typeof value === 'boolean') return value ? 'Yes' : 'No';

  if (isRecord(value)) {
    for (const candidate of ['name', 'title', 'displayName', 'identifier', 'id']) {
      const nested = readDisplayString(value[candidate], candidate);
      if (nested) return nested;
    }
  }
};

const DATE_FIELD_KEYS = new Set([
  'createdAt',
  'updatedAt',
  'completedAt',
  'startedAt',
  'canceledAt',
  'archivedAt',
  'dueDate',
]);

// Linear timestamps arrive as ISO strings (`2026-06-16T02:14:32.612Z`); show the
// concrete date + time as `YYYY-MM-DD HH:mm:ss` (dropping the millisecond / `Z`
// noise) instead of the raw ISO string. Date-only values (e.g. `dueDate`) are
// left untouched.
export const formatIsoDate = (value: string): string => {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?)/u.exec(value);
  return match ? `${match[1]} ${match[2]}` : value;
};

const pickField = (record: Record<PropertyKey, unknown>, key: string): LinearField | undefined => {
  const value = readDisplayString(record[key], key);
  if (!value) return;

  return {
    key,
    label: key === 'id' ? 'ID' : key === 'url' ? 'URL' : toLabel(key),
    value: DATE_FIELD_KEYS.has(key) ? formatIsoDate(value) : value,
  };
};

const collectFields = (
  record: Record<PropertyKey, unknown>,
  keys: readonly string[],
): LinearField[] =>
  keys.map((key) => pickField(record, key)).filter((field): field is LinearField => Boolean(field));

export const getLinearRequestFields = (args: unknown): LinearField[] => {
  if (!isRecord(args)) return [];

  return collectFields(args, FIELD_KEYS);
};

const getTextFromContentItem = (item: unknown): string => {
  if (typeof item === 'string') return item;
  if (!isRecord(item)) return stringifyUnknown(item);

  return trimString(item.text) || trimString(item.content) || stringifyUnknown(item);
};

const parseJsonString = (value: string): unknown => safeParseJSON(value);

const parseContentText = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();
  if (!trimmed) return undefined;

  return parseJsonString(trimmed) ?? trimmed;
};

const unwrapResultEnvelope = (value: unknown): unknown => {
  if (!isRecord(value)) return value;

  if ('Ok' in value) return value.Ok;
  if ('Err' in value) return value.Err;
  if ('ok' in value) return value.ok;
  if ('error' in value && Object.keys(value).length === 1) return value.error;

  return value;
};

const parseResultContent = (content: unknown): unknown => {
  const parsed = unwrapResultEnvelope(parseContentText(content));

  if (Array.isArray(parsed)) {
    const joined = parsed.map(getTextFromContentItem).filter(Boolean).join('\n\n');
    return parseContentText(joined) ?? parsed;
  }

  if (isRecord(parsed) && Array.isArray(parsed.content)) {
    const joined = parsed.content.map(getTextFromContentItem).filter(Boolean).join('\n\n');
    return parseContentText(joined) ?? parsed;
  }

  return parsed;
};

const extractUrl = (record: Record<PropertyKey, unknown>) =>
  readDisplayString(record.url, 'url') || readDisplayString(record.webUrl, 'url');

export const getLinearLinks = (value: unknown): LinearLink[] => {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!isRecord(item)) return;

      const url = extractUrl(item);
      if (!url) return;

      return {
        title: readDisplayString(item.title) || readDisplayString(item.name) || url,
        url,
      };
    })
    .filter((link): link is LinearLink => Boolean(link));
};

const buildEntity = (record: Record<PropertyKey, unknown>): LinearEntity | undefined => {
  const id = readDisplayString(record.id, 'id') || readDisplayString(record.identifier, 'id');
  const title =
    readDisplayString(record.title) ||
    readDisplayString(record.name) ||
    readDisplayString(record.subject);
  const url = extractUrl(record);
  const state =
    readDisplayString(record.state, 'state') || readDisplayString(record.status, 'status');
  const description =
    readDisplayString(record.description) ||
    readDisplayString(record.body) ||
    readDisplayString(record.content);
  const fields = collectFields(record, ENTITY_FIELD_KEYS).filter(
    (field) => !((field.key === 'state' || field.key === 'status') && field.value === state),
  );
  const links = getLinearLinks(record.links);
  const updatedAt = trimString(record.updatedAt);

  if (
    !id &&
    !title &&
    !url &&
    !state &&
    !description &&
    !updatedAt &&
    fields.length === 0 &&
    links.length === 0
  )
    return;

  return {
    description,
    fields,
    id,
    links,
    state,
    title,
    updatedAt,
    url,
  };
};

// Identity fields that mark a record as a single entity (issue / comment /
// document / …) rather than a list/search wrapper. buildEntity reads the id from
// `id | identifier` and the title from `title | name | subject`, so the same
// keys decide whether an object "is" an entity.
const ENTITY_IDENTITY_KEYS = ['id', 'identifier', 'title', 'name', 'subject'] as const;

const looksLikeEntity = (record: Record<PropertyKey, unknown>): boolean =>
  ENTITY_IDENTITY_KEYS.some((key) => Boolean(readDisplayString(record[key])));

interface LinearResultShape {
  /** The collection key when the result is a list wrapper (e.g. `comments`). */
  collectionKey?: string;
  records: Record<PropertyKey, unknown>[];
}

const extractResultShape = (value: unknown): LinearResultShape => {
  if (Array.isArray(value)) return { records: value.filter(isRecord) };
  if (!isRecord(value)) return { records: [] };

  // Wrapper responses (`list_*`, `search`, fetch-collection) carry their payload
  // in a nested collection (`{ issues: [...] }`, `{ results: [...] }`) and have
  // no identity of their own. A single entity (`get_*` / `save_*` / `create_*` /
  // fetch-one) has its own id/title and may merely *embed* sub-collections
  // (`documents: []`, `attachments: []`) whose keys overlap RESULT_ARRAY_KEYS —
  // those must not hijack the entity (an empty `documents: []` would otherwise
  // yield zero records → raw JSON fallback). So only unwrap nested collections
  // when the object itself doesn't look like an entity. This is verb-agnostic on
  // purpose: Codex routes Linear `search` through a bare `search` apiName that
  // parses to `verb: 'other'`, so keying off the verb would miss it.
  if (!looksLikeEntity(value)) {
    for (const key of RESULT_ARRAY_KEYS) {
      const nested = value[key];
      if (Array.isArray(nested)) return { collectionKey: key, records: nested.filter(isRecord) };
    }
  }

  return { records: [value] };
};

const getErrorText = (error: unknown): string | undefined => {
  if (!error) return;
  if (typeof error === 'string') return error.trim() || undefined;
  if (isRecord(error)) {
    return (
      readDisplayString(error.message) || readDisplayString(error.error) || stringifyUnknown(error)
    );
  }

  return stringifyUnknown(error);
};

export const buildLinearRenderModel = ({
  apiName,
  args,
  content,
  pluginError,
}: {
  apiName?: string;
  args: unknown;
  content: unknown;
  pluginError?: unknown;
}): LinearRenderModel => {
  const parsedTool = parseToolName(apiName || '');
  const result = parseResultContent(content);
  const { collectionKey, records } = extractResultShape(result);
  const resultEntities = records
    .map(buildEntity)
    .filter((entity): entity is LinearEntity => Boolean(entity));
  const resultText = typeof result === 'string' ? result : undefined;
  // A list wrapper that unwrapped to zero records (e.g. `{ comments: [] }`) is an
  // intentional empty result — show a "no results" message rather than the raw
  // JSON payload.
  const emptyCollectionKey = collectionKey && records.length === 0 ? collectionKey : undefined;
  const rawResultJson =
    result !== undefined &&
    typeof result !== 'string' &&
    resultEntities.length === 0 &&
    !emptyCollectionKey
      ? stringifyUnknown(result)
      : undefined;

  return {
    actionLabel: staticLabelFor(parsedTool),
    emptyCollectionKey,
    errorText: getErrorText(pluginError),
    requestFields: getLinearRequestFields(args),
    requestLinks: isRecord(args) ? getLinearLinks(args.links) : [],
    resultEntities,
    resultText,
    rawResultJson,
  };
};
