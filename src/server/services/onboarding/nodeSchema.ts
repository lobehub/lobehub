import type { UserAgentOnboardingDraft, UserAgentOnboardingNode } from '@lobechat/types';

type FieldType = 'string' | 'string[]';

interface FieldDef {
  maxItems?: number;
  required?: boolean;
  type: FieldType;
}

export interface NodeSchema {
  fields: Record<string, FieldDef>;
}

interface NodeDraftState {
  missingFields?: string[];
  status: 'complete' | 'empty' | 'partial';
}

const s = (required = false): FieldDef => ({ required, type: 'string' });
const sa = (maxItems = 8): FieldDef => ({ maxItems, type: 'string[]' });

export const NODE_SCHEMAS: Partial<Record<UserAgentOnboardingNode, NodeSchema>> = {
  agentIdentity: {
    fields: {
      emoji: s(true),
      name: s(true),
      nature: s(true),
      vibe: s(true),
    },
  },
  painPoints: {
    fields: {
      blockedBy: sa(),
      frustrations: sa(),
      noTimeFor: sa(),
      summary: s(true),
    },
  },
  userIdentity: {
    fields: {
      domainExpertise: s(),
      name: s(),
      professionalRole: s(),
      summary: s(true),
    },
  },
  workContext: {
    fields: {
      activeProjects: sa(),
      currentFocus: s(),
      interests: sa(),
      summary: s(true),
      thisQuarter: s(),
      thisWeek: s(),
      tools: sa(),
    },
  },
  workStyle: {
    fields: {
      communicationStyle: s(),
      decisionMaking: s(),
      socialMode: s(),
      summary: s(true),
      thinkingPreferences: s(),
      workStyle: s(),
    },
  },
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const sanitizeText = (value?: string) => value?.trim() || undefined;

const sanitizeTextList = (items?: unknown[], max = 8) =>
  (items ?? [])
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max);

export const normalizeFromSchema = (
  node: UserAgentOnboardingNode,
  raw: unknown,
  mode: 'committed' | 'draft',
): Record<string, unknown> | undefined => {
  const schema = NODE_SCHEMAS[node];
  if (!schema) return undefined;

  const patch = isRecord(raw) ? raw : undefined;
  if (!patch) return undefined;

  const result: Record<string, unknown> = {};

  for (const [key, def] of Object.entries(schema.fields)) {
    if (def.type === 'string') {
      const value = sanitizeText(typeof patch[key] === 'string' ? patch[key] : undefined);
      if (value) result[key] = value;
    } else {
      const value = sanitizeTextList(
        Array.isArray(patch[key]) ? patch[key] : undefined,
        def.maxItems,
      );
      if (value.length > 0) result[key] = value;
    }
  }

  if (Object.keys(result).length === 0) return undefined;

  if (mode === 'committed') {
    const requiredFields = Object.entries(schema.fields)
      .filter(([, def]) => def.required)
      .map(([key]) => key);

    for (const key of requiredFields) {
      const value = result[key];
      if (value === undefined) return undefined;
      if (Array.isArray(value) && value.length === 0) return undefined;
      if (typeof value === 'string' && !value.trim()) return undefined;
    }
  }

  return result;
};

export const getScopedPatch = (
  node: UserAgentOnboardingNode,
  patch: Record<string, unknown>,
): Record<string, unknown> => {
  const schema = NODE_SCHEMAS[node];
  if (!schema) return {};

  const nestedPatch = isRecord(patch[node]) ? patch[node] : undefined;
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(schema.fields)) {
    const value = patch[key] ?? nestedPatch?.[key];
    if (value !== undefined) result[key] = value;
  }

  return result;
};

export const getMissingFields = (
  node: UserAgentOnboardingNode,
  patch: Record<string, unknown>,
): string[] => {
  const schema = NODE_SCHEMAS[node];
  if (!schema) return [];

  return Object.entries(schema.fields)
    .filter(([, def]) => def.required)
    .map(([key]) => key)
    .filter((key) => {
      const value = patch[key];
      if (Array.isArray(value)) return value.length === 0;
      if (typeof value === 'string') return !value.trim();
      return value === undefined;
    });
};

export const getNodeDraftState = (
  node: UserAgentOnboardingNode | undefined,
  draft: UserAgentOnboardingDraft,
): NodeDraftState | undefined => {
  if (!node || node === 'summary') return undefined;

  if (node === 'responseLanguage') {
    return draft.responseLanguage
      ? { status: 'complete' }
      : { missingFields: ['responseLanguage'], status: 'empty' };
  }

  const currentDraft = draft[node];

  if (!currentDraft || Object.keys(currentDraft).length === 0) {
    const schema = NODE_SCHEMAS[node];
    const requiredFields = schema
      ? Object.entries(schema.fields)
          .filter(([, def]) => def.required)
          .map(([key]) => key)
      : [];
    return { missingFields: requiredFields, status: 'empty' };
  }

  const missingFields = getMissingFields(node, currentDraft as Record<string, unknown>);

  return {
    ...(missingFields.length > 0 ? { missingFields } : {}),
    status: missingFields.length === 0 ? 'complete' : 'partial',
  };
};
