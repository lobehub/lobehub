import { isRecord } from '@lobechat/utils/object';
import { safeParseJSON } from '@lobechat/utils/safeParseJSON';

import { parseGitHubToolName, staticGitHubLabelFor } from '../../Inspector/GitHub/labels';

const RESULT_ARRAY_KEYS = [
  'items',
  'nodes',
  'results',
  'pullRequests',
  'pull_requests',
  'issues',
  'repositories',
  'branches',
  'commits',
  'comments',
  'reviews',
] as const;

const FIELD_KEYS = [
  'repository_full_name',
  'repository',
  'full_name',
  'owner',
  'base',
  'head',
  'base_ref',
  'head_ref',
  'branch',
  'state',
  'draft',
  'merged',
  'mergeable',
  'private',
  'visibility',
  'language',
  'additions',
  'deletions',
  'changed_files',
  'comments',
  'review_comments',
] as const;

const DATE_FIELD_KEYS = new Set([
  'created_at',
  'updated_at',
  'closed_at',
  'merged_at',
  'pushed_at',
]);

export interface GitHubField {
  key: string;
  label: string;
  value: string;
}

export interface GitHubLink {
  title: string;
  url: string;
}

export interface GitHubEntity {
  description?: string;
  fields: GitHubField[];
  id?: string;
  kind: string;
  links: GitHubLink[];
  state?: string;
  title?: string;
  updatedAt?: string;
  url?: string;
}

export interface GitHubRenderModel {
  actionLabel: string;
  errorText?: string;
  rawResultJson?: string;
  resultEntities: GitHubEntity[];
  resultText?: string;
}

const toLabel = (key: string) =>
  key
    .replaceAll('_', ' ')
    .replaceAll(/([A-Z])/g, ' $1')
    .replace(/^./u, (char) => char.toUpperCase())
    .trim()
    .replace('Url', 'URL')
    .replace('Id', 'ID');

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

const readDisplayString = (value: unknown): string | undefined => {
  const stringValue = trimString(value);
  if (stringValue) return stringValue;

  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';

  if (isRecord(value)) {
    for (const candidate of ['full_name', 'name', 'title', 'login', 'ref', 'id']) {
      const nested = readDisplayString(value[candidate]);
      if (nested) return nested;
    }
  }
};

export const formatIsoDate = (value: string): string => {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?)/u.exec(value);
  return match ? `${match[1]} ${match[2]}` : value;
};

const pickField = (record: Record<PropertyKey, unknown>, key: string): GitHubField | undefined => {
  const value = readDisplayString(record[key]);
  if (!value) return;

  return {
    key,
    label: toLabel(key),
    value: DATE_FIELD_KEYS.has(key) ? formatIsoDate(value) : value,
  };
};

const collectFields = (
  record: Record<PropertyKey, unknown>,
  keys: readonly string[],
): GitHubField[] =>
  keys.map((key) => pickField(record, key)).filter((field): field is GitHubField => Boolean(field));

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

const isWebGithubUrl = (url?: string) =>
  Boolean(url && /^https?:\/\/github\.com\//iu.test(url.trim()));

const extractUrl = (record: Record<PropertyKey, unknown>) => {
  const htmlUrl = readDisplayString(record.html_url) || readDisplayString(record.webUrl);
  if (htmlUrl) return htmlUrl;

  const url = readDisplayString(record.url);
  return isWebGithubUrl(url) ? url : undefined;
};

const getGitHubLinks = (value: unknown): GitHubLink[] => {
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
    .filter((link): link is GitHubLink => Boolean(link));
};

const getRepoName = (record: Record<PropertyKey, unknown>, args: unknown): string | undefined => {
  const fromRecord =
    readDisplayString(record.repository_full_name) ||
    readDisplayString(record.full_name) ||
    readDisplayString(record.repository);
  if (fromRecord) return fromRecord;

  if (!isRecord(args)) return;

  const fromArgs =
    readDisplayString(args.repository_full_name) ||
    readDisplayString(args.full_name) ||
    readDisplayString(args.repository) ||
    readDisplayString(args.repo);
  if (fromArgs) return fromArgs;

  const owner = readDisplayString(args.owner);
  const name = readDisplayString(args.name);
  return owner && name ? `${owner}/${name}` : undefined;
};

const inferKind = (
  record: Record<PropertyKey, unknown>,
  apiName: string | undefined,
  url?: string,
): string => {
  const api = apiName || '';
  if (
    api.includes('pull_request') ||
    url?.includes('/pull/') ||
    'mergeable' in record ||
    'draft' in record
  ) {
    return 'Pull request';
  }

  if (api.includes('issue') || url?.includes('/issues/')) return 'Issue';
  if (api.includes('repository') || 'full_name' in record) return 'Repository';
  if (api.includes('branch') || 'ref' in record) return 'Branch';
  if (api.includes('commit') || 'sha' in record) return 'Commit';
  if (api.includes('comment')) return 'Comment';

  return 'Result';
};

const pickState = (record: Record<PropertyKey, unknown>): string | undefined => {
  if (record.merged === true) return 'Merged';
  if (record.draft === true) return 'Draft';

  const state = readDisplayString(record.state) || readDisplayString(record.status);
  return state ? state.replace(/^./u, (char) => char.toUpperCase()) : undefined;
};

const pickId = (record: Record<PropertyKey, unknown>): string | undefined => {
  const number = readDisplayString(record.number);
  if (number) return `#${number}`;

  const sha = readDisplayString(record.sha);
  if (sha) return sha.slice(0, 12);

  return readDisplayString(record.id);
};

const buildEntity = (
  record: Record<PropertyKey, unknown>,
  args: unknown,
  apiName?: string,
): GitHubEntity | undefined => {
  const url = extractUrl(record);
  const kind = inferKind(record, apiName, url);
  const repo = getRepoName(record, args);
  const title =
    readDisplayString(record.title) ||
    readDisplayString(record.name) ||
    readDisplayString(record.full_name) ||
    readDisplayString(record.path) ||
    readDisplayString(record.message);
  const id = pickId(record);
  const state = pickState(record);
  const description =
    readDisplayString(record.body) ||
    readDisplayString(record.description) ||
    readDisplayString(record.content);
  const fields = [
    ...(repo ? [{ key: 'repository', label: 'Repository', value: repo }] : []),
    ...collectFields(record, FIELD_KEYS).filter(
      (field) =>
        field.value !== repo &&
        !(
          (field.key === 'state' || field.key === 'status') &&
          field.value.toLowerCase() === state?.toLowerCase()
        ),
    ),
  ];
  const links = getGitHubLinks(record.links);
  const updatedAt = readDisplayString(record.updated_at) || readDisplayString(record.updatedAt);

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
    kind,
    links,
    state,
    title,
    updatedAt,
    url,
  };
};

const ENTITY_IDENTITY_KEYS = [
  'id',
  'number',
  'title',
  'name',
  'full_name',
  'sha',
  'html_url',
  'url',
] as const;

const looksLikeEntity = (record: Record<PropertyKey, unknown>): boolean =>
  ENTITY_IDENTITY_KEYS.some((key) => Boolean(readDisplayString(record[key])));

const extractResultRecords = (value: unknown): Record<PropertyKey, unknown>[] => {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];

  if (!looksLikeEntity(value)) {
    for (const key of RESULT_ARRAY_KEYS) {
      const nested = value[key];
      if (Array.isArray(nested)) return nested.filter(isRecord);
    }
  }

  return [value];
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

export const buildGitHubRenderModel = ({
  apiName,
  args,
  content,
  pluginError,
}: {
  apiName?: string;
  args: unknown;
  content: unknown;
  pluginError?: unknown;
}): GitHubRenderModel => {
  const result = parseResultContent(content);
  const resultEntities = extractResultRecords(result)
    .map((record) => buildEntity(record, args, apiName))
    .filter((entity): entity is GitHubEntity => Boolean(entity));
  const resultText = typeof result === 'string' ? result : undefined;
  const rawResultJson =
    result !== undefined && typeof result !== 'string' && resultEntities.length === 0
      ? stringifyUnknown(result)
      : undefined;

  return {
    actionLabel: staticGitHubLabelFor(parseGitHubToolName(apiName || '')),
    errorText: getErrorText(pluginError),
    rawResultJson,
    resultEntities,
    resultText,
  };
};
