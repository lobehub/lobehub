import { createHash } from 'node:crypto';

import type {
  AgentInterventionAllowedAction,
  AgentInterventionCustomExecutionResult,
  AgentInterventionResolutionAction,
  AgentInterventionSanitizedRequest,
} from '@lobechat/types';

export const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export interface CanonicalJsonOptions {
  omitUndefinedObjectProperties?: boolean;
}

export const canonicalJson = (
  value: unknown,
  options: CanonicalJsonOptions = {},
  ancestors = new Set<object>(),
): string => {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Value is not JSON-safe');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') throw new TypeError('Value is not JSON-safe');
  if (ancestors.has(value)) throw new TypeError('Cyclic value is not JSON-safe');

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (
        Object.getPrototypeOf(value) !== Array.prototype ||
        Object.keys(value).length !== value.length ||
        Reflect.ownKeys(value).length !== value.length + 1
      ) {
        throw new TypeError('Non-standard array is not JSON-safe');
      }
      const items: string[] = [];
      for (let index = 0; index < value.length; index++) {
        if (!Object.hasOwn(value, index)) throw new TypeError('Sparse array is not JSON-safe');
        items.push(canonicalJson(value[index], options, ancestors));
      }
      return `[${items.join(',')}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Non-plain object is not JSON-safe');
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (Reflect.ownKeys(record).length !== keys.length) {
      throw new TypeError('Hidden or symbol properties are not JSON-safe');
    }
    const serializedKeys = options.omitUndefinedObjectProperties
      ? keys.filter((key) => record[key] !== undefined)
      : keys;
    return `{${serializedKeys
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key], options, ancestors)}`)
      .join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
};

export const sameJson = (left: unknown, right: unknown): boolean =>
  canonicalJson(left) === canonicalJson(right);

export const canonicalDtoJson = (value: unknown): string =>
  canonicalJson(value, { omitUndefinedObjectProperties: true });

export const sameDtoJson = (left: unknown, right: unknown): boolean =>
  canonicalDtoJson(left) === canonicalDtoJson(right);

export const normalizeDtoJson = <T>(value: T): T => JSON.parse(canonicalDtoJson(value)) as T;

export const isCanonicalJsonSafe = (value: unknown): boolean => {
  try {
    canonicalJson(value);
    return true;
  } catch {
    return false;
  }
};

export const isCanonicalDtoJsonSafe = (value: unknown): boolean => {
  try {
    canonicalDtoJson(value);
    return true;
  } catch {
    return false;
  }
};

export const uniqueSorted = (values: readonly string[]): string[] => [...new Set(values)].sort();

export const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const isCustomExecutionResult = (
  value: unknown,
): value is AgentInterventionCustomExecutionResult =>
  isPlainRecord(value) &&
  hasOnlyKeys(value, ['content', 'pluginState']) &&
  typeof value.content === 'string' &&
  isPlainRecord(value.pluginState) &&
  isCanonicalJsonSafe(value);

export const hasOnlyKeys = (
  record: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean => {
  const allowed = new Set(allowedKeys);
  return Object.keys(record).every((key) => allowed.has(key));
};

export const hasExactKeys = (record: Record<string, unknown>, ids: string[]): boolean => {
  const keys = Object.keys(record).sort();
  const expected = [...ids].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
};

export const actionCapability = (
  action: AgentInterventionResolutionAction,
): AgentInterventionAllowedAction => action.type;

export const terminalStatusForAction = (
  action: AgentInterventionResolutionAction,
): 'cancelled' | 'resolved' =>
  action.type === 'cancel_interaction' || action.type === 'stop' ? 'cancelled' : 'resolved';

/** Exact digest used for CAS against the authoritative message plugin string. */
export const hashAgentInterventionRequestRevision = (argumentsText: string): string =>
  createHash('sha256').update(argumentsText).digest('hex');

export const providerOptionIds = (request: AgentInterventionSanitizedRequest): Set<string> => {
  const ids = new Set<string>();
  for (const option of request.options ?? []) if (option.id) ids.add(option.id);
  for (const question of request.questions ?? []) {
    for (const option of question.options) if (option.id) ids.add(option.id);
  }
  for (const field of request.fields ?? []) {
    for (const option of field.options ?? []) if (option.id) ids.add(option.id);
  }
  return ids;
};

export const isBoundedFormValue = (value: unknown): boolean => {
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length <= 10_000;
  return (
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every((item) => typeof item === 'string' && item.length <= 10_000)
  );
};

export const hasBoundedFormRecord = (value: unknown): value is Record<string, unknown> => {
  if (!isPlainRecord(value)) return false;
  const record = value;
  const entries = Object.entries(record);
  return (
    entries.length <= 100 &&
    entries.every(([key, item]) => key.length > 0 && key.length <= 256 && isBoundedFormValue(item))
  );
};

export const hasValidAnswers = (
  request: AgentInterventionSanitizedRequest,
  answersValue: unknown,
): boolean => {
  if (!hasBoundedFormRecord(answersValue)) return false;
  const answers = answersValue;
  const definitions = new Map<
    string,
    {
      allowCustomAnswer: boolean;
      multi: boolean;
      options: Set<string>;
      required: boolean;
      type: 'boolean' | 'number' | 'string';
    }
  >();
  for (const question of request.questions ?? []) {
    definitions.set(question.id ?? question.question, {
      allowCustomAnswer: question.allowCustomAnswer === true,
      multi: question.multiSelect === true,
      options: new Set(question.options.map((option) => option.id ?? option.label)),
      required: true,
      type: 'string',
    });
  }
  for (const field of request.fields ?? []) {
    definitions.set(field.id, {
      allowCustomAnswer: false,
      multi: field.type === 'multi_select',
      options: new Set((field.options ?? []).map((option) => option.id ?? option.label)),
      required: field.required === true,
      type: field.type === 'boolean' ? 'boolean' : field.type === 'number' ? 'number' : 'string',
    });
  }
  const { allowFreeform = false, allowSupplement = false } = request.answerPolicy ?? {};
  if (definitions.size === 0 && !allowFreeform) return false;
  const allowedSpecialKeys = new Set<string>();
  if (allowFreeform) allowedSpecialKeys.add('__freeform__');
  if (allowSupplement) allowedSpecialKeys.add('__supplement__');
  if (
    Object.keys(answers).some((key) => !definitions.has(key) && !allowedSpecialKeys.has(key)) ||
    ('__freeform__' in answers && typeof answers.__freeform__ !== 'string') ||
    ('__supplement__' in answers && typeof answers.__supplement__ !== 'string')
  ) {
    return false;
  }
  const hasFreeform = typeof answers.__freeform__ === 'string' && answers.__freeform__.length > 0;

  for (const [id, definition] of definitions) {
    const value = answers[id];
    if (value === undefined || value === null) {
      if (definition.required && !hasFreeform) return false;
      continue;
    }
    if (definition.multi) {
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return false;
      // A multi-select question with "write your own" enabled carries the typed
      // answer as one more entry in the array, exactly as the single-select
      // branch below carries it as the scalar value. Whitelist the options only
      // when the question forbids custom answers.
      if (
        definition.options.size > 0 &&
        !definition.allowCustomAnswer &&
        value.some((item) => !definition.options.has(item as string))
      ) {
        return false;
      }
      continue;
    }
    if (Array.isArray(value) || typeof value !== definition.type) return false;
    if (
      definition.options.size > 0 &&
      (typeof value !== 'string' ||
        (!definition.options.has(value) && !definition.allowCustomAnswer))
    ) {
      return false;
    }
  }
  return true;
};

export const hasValidCustomDetail = (request: AgentInterventionSanitizedRequest): boolean => {
  const detailValue: unknown = request.customDetail;
  if (detailValue === undefined) return true;
  if (!isPlainRecord(detailValue)) return false;
  const agentsValue = detailValue.agents;
  if (
    !hasOnlyKeys(detailValue, ['agents', 'categoryHints', 'kind', 'requestId', 'selectedIds']) ||
    detailValue.kind !== 'agent_marketplace' ||
    !Array.isArray(agentsValue) ||
    agentsValue.length > 100
  ) {
    return false;
  }
  const detail = detailValue;
  const agents: unknown[] = agentsValue;
  const ids = agents.map((agent) => (isPlainRecord(agent) ? agent.id : undefined));
  if (
    ids.some((id) => typeof id !== 'string') ||
    new Set(ids).size !== ids.length ||
    agents.some(
      (agent) =>
        !isPlainRecord(agent) ||
        !hasOnlyKeys(agent, ['avatar', 'description', 'id', 'title']) ||
        typeof agent.id !== 'string' ||
        !agent.id ||
        agent.id.length > 256 ||
        typeof agent.title !== 'string' ||
        !agent.title ||
        agent.title.length > 500 ||
        (agent.avatar !== undefined &&
          (typeof agent.avatar !== 'string' || agent.avatar.length > 2048)) ||
        (agent.description !== undefined &&
          (typeof agent.description !== 'string' || agent.description.length > 10_000)),
    ) ||
    (detail.selectedIds !== undefined &&
      (!Array.isArray(detail.selectedIds) ||
        detail.selectedIds.length > 100 ||
        detail.selectedIds.some((id) => typeof id !== 'string' || !ids.includes(id)) ||
        new Set(detail.selectedIds).size !== detail.selectedIds.length)) ||
    (detail.categoryHints !== undefined &&
      (!Array.isArray(detail.categoryHints) ||
        detail.categoryHints.length > 50 ||
        detail.categoryHints.some(
          (hint) => typeof hint !== 'string' || !hint || hint.length > 256,
        ))) ||
    (detail.requestId !== undefined &&
      (typeof detail.requestId !== 'string' || !detail.requestId || detail.requestId.length > 256))
  ) {
    return false;
  }
  return true;
};

export const hasValidCustomResult = (
  request: AgentInterventionSanitizedRequest,
  resultValue: unknown,
): boolean => {
  if (!hasBoundedFormRecord(resultValue)) return false;
  const detail = request.customDetail;
  if (!detail) return true;
  if (detail.kind === 'agent_marketplace') {
    const result = resultValue;
    if (!hasExactKeys(result, ['selectedIds']) || !Array.isArray(result.selectedIds)) return false;
    const allowedIds = new Set(detail.agents.map((agent) => agent.id));
    return (
      new Set(result.selectedIds).size === result.selectedIds.length &&
      result.selectedIds.every((id) => typeof id === 'string' && allowedIds.has(id))
    );
  }
  return false;
};
