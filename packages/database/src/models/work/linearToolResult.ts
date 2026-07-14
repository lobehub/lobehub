import type {
  LinearWorkResourceType,
  RegisterExternalWorkParams,
  SkillToolResultWorkInput,
  WorkDisplayField,
} from '@lobechat/types';

import { WORK_DESCRIPTION_PREVIEW_LENGTH } from './internal';
import {
  type ExternalToolWorkOperation,
  fromRecord,
  hasOwn,
  isApplicationError,
  parseMaybeJSON,
  sanitizeExternalUrl,
  stringValue,
  toRecord,
} from './toolResultParsing';

/** Linear entity vocabulary internal to this normalizer. */
type LinearWorkEntityType = 'document' | 'issue';

const LINEAR_CREATE_TOOLS = new Set(['create_document', 'save_document', 'save_issue']);
const LINEAR_ISSUE_IDENTIFIER_PATTERN = /^[A-Z][A-Z0-9]+-\d+$/u;

/** The card-preview `description` column stores capped text; the full body goes to `content`. */
const previewText = (value: unknown): string | null => {
  const text = stringValue(value);
  if (!text) return null;

  return text.length > WORK_DESCRIPTION_PREVIEW_LENGTH
    ? `${text.slice(0, WORK_DESCRIPTION_PREVIEW_LENGTH)}...`
    : text;
};

const firstDefined = <T>(...values: Array<T | null | undefined>): T | null | undefined =>
  values.find((value) => value !== undefined);

const optionalStringFromRecord = (
  record: Record<string, unknown>,
  keys: string[],
): string | null | undefined => {
  for (const key of keys) {
    if (!hasOwn(record, key)) continue;

    const raw = record[key];
    if (raw === null) return null;

    const value = stringValue(raw);
    if (value) return value;
    if (typeof raw === 'string') return null;
  }

  return undefined;
};

const optionalTextFromRecord = (
  record: Record<string, unknown>,
  keys: string[],
): string | null | undefined => {
  for (const key of keys) {
    if (!hasOwn(record, key)) continue;

    const raw = record[key];
    if (raw === null) return null;

    const value = previewText(raw);
    if (value) return value;
    if (typeof raw === 'string') return null;
  }

  return undefined;
};

const optionalStringFromNestedRecord = (
  record: Record<string, unknown>,
  key: string,
  keys: string[],
): string | null | undefined => {
  if (!hasOwn(record, key)) return undefined;
  if (record[key] === null) return null;

  const nested = toRecord(record[key]);
  if (!nested) return undefined;

  return optionalStringFromRecord(nested, keys) ?? null;
};

const nestedRecord = (record: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const nested = toRecord(record[key]);
    if (nested) return nested;
  }

  return record;
};

const unwrapData = (data: unknown, keys: string[]) => {
  const parsed = parseMaybeJSON(data);
  if (Array.isArray(parsed)) return toRecord(parsed[0]) ?? null;

  const record = toRecord(parsed);
  if (!record) return null;

  return nestedRecord(record, keys);
};

const isIssueIdentifier = (value: string | null) =>
  value ? LINEAR_ISSUE_IDENTIFIER_PATTERN.test(value) : false;

const urlSegmentAfter = (url: string | null, segmentName: string) => {
  if (!url) return null;

  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    const index = segments.indexOf(segmentName);
    return index >= 0 ? decodeURIComponent(segments[index + 1] ?? '') || null : null;
  } catch {
    return null;
  }
};

const resolveResourceIdentifier = (params: {
  entityType: LinearWorkEntityType;
  id: string;
  record: Record<string, unknown>;
  url: string | null;
}) => {
  switch (params.entityType) {
    case 'document': {
      return (
        fromRecord(params.record, ['slug']) ??
        urlSegmentAfter(params.url, 'document') ??
        fromRecord(params.record, ['slugId'])
      );
    }

    case 'issue': {
      return (
        fromRecord(params.record, ['identifier', 'key']) ??
        (isIssueIdentifier(params.id) ? params.id : null) ??
        urlSegmentAfter(params.url, 'issue')
      );
    }
  }
};

const linearResourceType = (entityType: LinearWorkEntityType): LinearWorkResourceType => {
  switch (entityType) {
    case 'document': {
      return 'linear_document';
    }
    case 'issue': {
      return 'linear_issue';
    }
  }
};

const contextParams = (
  params: SkillToolResultWorkInput,
): Pick<
  RegisterExternalWorkParams,
  | 'agentId'
  | 'cumulativeCost'
  | 'cumulativeUsage'
  | 'messageId'
  | 'rootOperationId'
  | 'threadId'
  | 'toolCallId'
  | 'toolName'
  | 'topicId'
> => ({
  agentId: params.agentId ?? null,
  cumulativeCost: params.cumulativeCost ?? null,
  cumulativeUsage: params.cumulativeUsage ?? null,
  messageId: params.messageId ?? null,
  rootOperationId: params.rootOperationId ?? null,
  threadId: params.threadId ?? null,
  toolCallId: params.toolCallId ?? null,
  toolName: params.toolName,
  topicId: params.topicId ?? null,
});

const createRegisterOperation = (
  params: SkillToolResultWorkInput,
  entityType: LinearWorkEntityType,
  record: Record<string, unknown>,
): ExternalToolWorkOperation | null => {
  const id = fromRecord(record, ['id', 'uuid', 'identifier', 'slug', 'slugId']);
  if (!id) return null;

  const url = fromRecord(record, ['url', 'appUrl']);
  const identifier = resolveResourceIdentifier({ entityType, id, record, url });
  const patchFields = new Set<WorkDisplayField>();
  const patch = <T>(field: WorkDisplayField, value: T | null | undefined) => {
    if (value !== undefined) patchFields.add(field);
    return value;
  };

  if (identifier) patchFields.add('identifier');

  return {
    params: {
      ...contextParams(params),
      changeType:
        LINEAR_CREATE_TOOLS.has(params.toolName) && !params.args?.id ? 'created' : 'updated',
      // The FULL body (layer 3); the card preview is the capped `description` below.
      content: patch(
        'content',
        firstDefined(
          optionalStringFromRecord(record, ['description']),
          optionalStringFromRecord(record, ['content']),
        ),
      ),
      // Documents carry their preview in `content`; issues in `description`.
      description: patch(
        'description',
        firstDefined(
          optionalTextFromRecord(record, ['description']),
          optionalTextFromRecord(record, ['content']),
        ),
      ),
      identifier,
      resourceId: id,
      resourceType: linearResourceType(entityType),
      status: patch(
        'status',
        firstDefined(
          optionalStringFromRecord(record, ['status', 'state', 'statusName', 'stateName']),
          optionalStringFromNestedRecord(record, 'state', ['name', 'type']),
        ),
      ),
      title: patch('title', optionalStringFromRecord(record, ['title', 'name', 'subject'])),
      // Allowlist http(s) only: the persisted url reaches shell.openExternal on
      // desktop, and a member could plant a `javascript:`/`file:` scheme here.
      url: patch('url', sanitizeExternalUrl(optionalStringFromRecord(record, ['url', 'appUrl']))),
      // Evaluated last: every patch() call above must run before the set is
      // materialized (object literal properties evaluate in order).
      patchFields: Array.from(patchFields),
    },
    type: 'register',
  };
};

export const normalizeLinearToolResult = (
  params: SkillToolResultWorkInput,
): ExternalToolWorkOperation | null => {
  if (isApplicationError(params.data)) return null;

  switch (params.toolName) {
    case 'save_issue': {
      const issue = unwrapData(params.data, ['issue', 'data', 'result']);
      return issue ? createRegisterOperation(params, 'issue', issue) : null;
    }

    case 'create_document':
    case 'save_document':
    case 'update_document': {
      const document = unwrapData(params.data, ['document', 'data', 'result']);
      return document ? createRegisterOperation(params, 'document', document) : null;
    }

    default: {
      return null;
    }
  }
};
