import type {
  LinearWorkEntityType,
  LinearWorkPatchField,
  LinearWorkResourceType,
  RegisterLinearToolResultWorkParams,
  RegisterLinearWorkParams,
} from '@lobechat/types';

import {
  fromRecord,
  hasOwn,
  isApplicationError,
  parseMaybeJSON,
  stringValue,
  toRecord,
} from './toolResultParsing';

const LINEAR_CREATE_TOOLS = new Set(['create_document', 'save_document', 'save_issue']);
const LINEAR_ISSUE_IDENTIFIER_PATTERN = /^[A-Z][A-Z0-9]+-\d+$/u;
const MAX_LINEAR_SNAPSHOT_TEXT_LENGTH = 4000;

interface LinearToolRegisterOperation {
  params: RegisterLinearWorkParams;
  type: 'register';
}

export type LinearToolWorkOperation = LinearToolRegisterOperation;

const snapshotText = (value: unknown): string | null => {
  const text = stringValue(value);
  if (!text) return null;

  return text.length > MAX_LINEAR_SNAPSHOT_TEXT_LENGTH
    ? `${text.slice(0, MAX_LINEAR_SNAPSHOT_TEXT_LENGTH)}...`
    : text;
};

const numberValue = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

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

    const value = snapshotText(raw);
    if (value) return value;
    if (typeof raw === 'string') return null;
  }

  return undefined;
};

const optionalNumberFromRecord = (
  record: Record<string, unknown>,
  keys: string[],
): number | null | undefined => {
  for (const key of keys) {
    if (!hasOwn(record, key)) continue;

    const raw = record[key];
    if (raw === null) return null;

    const value = numberValue(raw);
    if (value !== null) return value;
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

const optionalNumberFromNestedRecord = (
  record: Record<string, unknown>,
  key: string,
  keys: string[],
): number | null | undefined => {
  if (!hasOwn(record, key)) return undefined;
  if (record[key] === null) return null;

  const nested = toRecord(record[key]);
  if (!nested) return undefined;

  return optionalNumberFromRecord(nested, keys) ?? null;
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

const extractLabels = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      const record = toRecord(item);
      return record ? fromRecord(record, ['name', 'id']) : stringValue(item);
    })
    .filter((label): label is string => !!label);
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

const firstValue = (...values: Array<string | null | undefined>) =>
  values.find((value): value is string => !!value) ?? null;

const resolveTarget = (
  params: RegisterLinearToolResultWorkParams,
  record: Record<string, unknown>,
) => {
  const args = params.args ?? {};
  const issue = toRecord(record.issue);
  const document = toRecord(record.document);
  const initiative = toRecord(record.initiative);
  const milestone = toRecord(record.milestone);
  const project = toRecord(record.project);

  const issueId =
    fromRecord(record, ['issueId']) ?? fromRecord(issue ?? {}, ['id']) ?? stringValue(args.issueId);
  const documentId =
    fromRecord(record, ['documentId']) ??
    fromRecord(document ?? {}, ['id', 'slugId', 'slug']) ??
    stringValue(args.documentId);
  const initiativeId =
    fromRecord(record, ['initiativeId']) ??
    fromRecord(initiative ?? {}, ['id']) ??
    stringValue(args.initiativeId);
  const milestoneId =
    fromRecord(record, ['milestoneId']) ??
    fromRecord(milestone ?? {}, ['id']) ??
    stringValue(args.milestoneId);
  const projectId =
    fromRecord(record, ['projectId']) ??
    fromRecord(project ?? {}, ['id', 'slug']) ??
    stringValue(args.projectId);

  const issueIdentifier = firstValue(
    fromRecord(record, ['issueIdentifier', 'issueKey']),
    fromRecord(issue ?? {}, ['identifier', 'key']),
    isIssueIdentifier(issueId) ? issueId : null,
  );
  const documentIdentifier =
    fromRecord(document ?? {}, ['slug', 'slugId', 'title', 'name']) ??
    (documentId ? stringValue(args.documentId) : null);
  const projectIdentifier =
    fromRecord(project ?? {}, ['slug', 'name', 'id']) ??
    (projectId ? stringValue(args.projectId) : null);

  if (issueId) {
    return {
      issueId,
      issueIdentifier,
      targetId: issueId,
      targetIdentifier: issueIdentifier,
      targetType: 'issue' as const,
    };
  }

  if (documentId) {
    return {
      issueId: null,
      issueIdentifier: null,
      targetId: documentId,
      targetIdentifier: documentIdentifier,
      targetType: 'document' as const,
    };
  }

  if (initiativeId) {
    return {
      issueId: null,
      issueIdentifier: null,
      targetId: initiativeId,
      targetIdentifier:
        fromRecord(initiative ?? {}, ['name', 'id']) ?? stringValue(args.initiativeId),
      targetType: 'initiative' as const,
    };
  }

  if (milestoneId) {
    return {
      issueId: null,
      issueIdentifier: null,
      targetId: milestoneId,
      targetIdentifier:
        fromRecord(milestone ?? {}, ['name', 'id']) ?? stringValue(args.milestoneId),
      targetType: 'milestone' as const,
    };
  }

  if (projectId) {
    return {
      issueId: null,
      issueIdentifier: null,
      targetId: projectId,
      targetIdentifier: projectIdentifier,
      targetType: 'project' as const,
    };
  }

  return {
    issueId: null,
    issueIdentifier: null,
    targetId: null,
    targetIdentifier: null,
    targetType: null,
  };
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
  params: RegisterLinearToolResultWorkParams,
): Pick<
  RegisterLinearWorkParams,
  | 'actorAgentId'
  | 'cumulativeCost'
  | 'cumulativeUsage'
  | 'rootOperationId'
  | 'source'
  | 'sourceMessageId'
  | 'sourceToolCallId'
  | 'threadId'
  | 'topicId'
> => ({
  actorAgentId: params.actorAgentId ?? null,
  cumulativeCost: params.cumulativeCost ?? null,
  cumulativeUsage: params.cumulativeUsage ?? null,
  rootOperationId: params.rootOperationId ?? null,
  source: params.toolName,
  sourceMessageId: params.sourceMessageId ?? null,
  sourceToolCallId: params.sourceToolCallId ?? null,
  threadId: params.threadId ?? null,
  topicId: params.topicId ?? null,
});

const createRegisterOperation = (
  params: RegisterLinearToolResultWorkParams,
  entityType: LinearWorkEntityType,
  record: Record<string, unknown>,
): LinearToolRegisterOperation | null => {
  const id = fromRecord(record, ['id', 'uuid', 'identifier', 'slug', 'slugId']);
  if (!id) return null;

  const url = fromRecord(record, ['url', 'appUrl']);
  const title = optionalStringFromRecord(record, ['title', 'name', 'subject']);
  const target = resolveTarget(params, record);
  const identifier = resolveResourceIdentifier({ entityType, id, record, url });
  const patchFields = new Set<LinearWorkPatchField>();
  const patch = <T>(field: LinearWorkPatchField, value: T | null | undefined) => {
    if (value !== undefined) patchFields.add(field);
    return value;
  };

  if (identifier) patchFields.add('identifier');
  if (target.issueId) patchFields.add('issueId');
  if (target.issueIdentifier) patchFields.add('issueIdentifier');
  if (target.targetId) patchFields.add('targetId');
  if (target.targetIdentifier) patchFields.add('targetIdentifier');
  if (target.targetType) patchFields.add('targetType');

  return {
    params: {
      ...contextParams(params),
      assignee: patch(
        'assignee',
        firstDefined(
          optionalStringFromRecord(record, ['assignee']),
          optionalStringFromNestedRecord(record, 'assignee', ['name', 'id']),
        ),
      ),
      assigneeId: patch(
        'assigneeId',
        firstDefined(
          optionalStringFromRecord(record, ['assigneeId']),
          optionalStringFromNestedRecord(record, 'assignee', ['id']),
        ),
      ),
      color: patch('color', optionalStringFromRecord(record, ['color'])),
      content: patch('content', optionalTextFromRecord(record, ['content'])),
      createdAt: patch('createdAt', optionalStringFromRecord(record, ['createdAt'])),
      description: patch('description', optionalTextFromRecord(record, ['description'])),
      dueDate: patch('dueDate', optionalStringFromRecord(record, ['dueDate'])),
      icon: patch('icon', optionalStringFromRecord(record, ['icon'])),
      issueId: target.issueId,
      issueIdentifier: target.issueIdentifier,
      labels:
        patch('labels', hasOwn(record, 'labels') ? extractLabels(record.labels) : undefined) ??
        undefined,
      parentId: patch('parentId', optionalStringFromRecord(record, ['parentId'])),
      priority: patch(
        'priority',
        firstDefined(
          optionalStringFromRecord(record, ['priority']),
          optionalStringFromNestedRecord(record, 'priority', ['name']),
        ),
      ),
      priorityValue: patch(
        'priorityValue',
        firstDefined(
          optionalNumberFromRecord(record, ['priority']),
          optionalNumberFromNestedRecord(record, 'priority', ['value']),
        ),
      ),
      project: patch(
        'project',
        firstDefined(
          optionalStringFromRecord(record, ['project']),
          optionalStringFromNestedRecord(record, 'project', ['name', 'slug', 'id']),
        ),
      ),
      projectId: patch(
        'projectId',
        firstDefined(
          optionalStringFromRecord(record, ['projectId']),
          optionalStringFromNestedRecord(record, 'project', ['id']),
        ),
      ),
      resourceId: id,
      resourceIdentifier: identifier,
      resourceType: linearResourceType(entityType),
      role: LINEAR_CREATE_TOOLS.has(params.toolName) && !params.args?.id ? 'created' : 'updated',
      status: patch(
        'status',
        firstDefined(
          optionalStringFromRecord(record, ['status', 'state', 'statusName', 'stateName']),
          optionalStringFromNestedRecord(record, 'state', ['name', 'type']),
        ),
      ),
      statusType: patch(
        'statusType',
        firstDefined(
          optionalStringFromRecord(record, ['statusType']),
          optionalStringFromNestedRecord(record, 'state', ['type']),
        ),
      ),
      slugId: patch('slugId', optionalStringFromRecord(record, ['slugId'])),
      targetId: target.targetId,
      targetIdentifier: target.targetIdentifier,
      targetType: target.targetType,
      team: patch(
        'team',
        firstDefined(
          optionalStringFromRecord(record, ['team']),
          optionalStringFromNestedRecord(record, 'team', ['name', 'key', 'id']),
        ),
      ),
      teamId: patch(
        'teamId',
        firstDefined(
          optionalStringFromRecord(record, ['teamId']),
          optionalStringFromNestedRecord(record, 'team', ['id']),
        ),
      ),
      title: patch('title', title),
      updatedAt: patch('updatedAt', optionalStringFromRecord(record, ['updatedAt'])),
      url: patch('url', optionalStringFromRecord(record, ['url', 'appUrl'])),
      patchFields: Array.from(patchFields),
    },
    type: 'register',
  };
};

export const normalizeLinearToolResult = (
  params: RegisterLinearToolResultWorkParams,
): LinearToolWorkOperation | null => {
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
