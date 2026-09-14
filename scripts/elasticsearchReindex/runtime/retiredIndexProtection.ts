import { createHash } from 'node:crypto';

import { z } from 'zod';

export const RETIRED_INDEX_PROTECTION_OWNER = 'lobehub-fts-search-retirement';
export const RETIRED_INDEX_PROTECTION_PRIORITY = 1_000_000;

const indexTemplateSchema = z.object({
  index_template: z
    .object({
      _meta: z.record(z.string(), z.unknown()).optional(),
      allow_auto_create: z.boolean().optional(),
      composed_of: z.array(z.string()).optional(),
      data_stream: z.unknown().optional(),
      index_patterns: z.array(z.string()),
      priority: z.number().int().optional(),
      template: z.record(z.string(), z.unknown()).optional(),
    })
    .passthrough(),
  name: z.string(),
});

export const indexTemplateListResponseSchema = z.object({
  index_templates: z.array(indexTemplateSchema),
});

export type RetiredIndexProtectionTemplate = {
  _meta: { index: string; owner: typeof RETIRED_INDEX_PROTECTION_OWNER };
  allow_auto_create: false;
  index_patterns: [string];
  priority: typeof RETIRED_INDEX_PROTECTION_PRIORITY;
  template: Record<string, never>;
};

export const assertExactRetiredIndexName = (index: string) => {
  if (!index || index === '_all' || /[*?,]/.test(index)) {
    throw new Error(`Retired index target must be one exact physical index name: ${index}`);
  }
};

export const getRetiredIndexProtectionTemplateName = (index: string) => {
  const digest = createHash('sha256').update(index).digest('hex').slice(0, 20);
  return `lobehub-fts-retired-${digest}`;
};

export const getRetiredIndexProtectionTemplate = (
  index: string,
): RetiredIndexProtectionTemplate => ({
  _meta: { index, owner: RETIRED_INDEX_PROTECTION_OWNER },
  allow_auto_create: false,
  index_patterns: [index],
  priority: RETIRED_INDEX_PROTECTION_PRIORITY,
  template: {},
});

const wildcardMatches = (pattern: string, value: string) => {
  const expression = [...pattern]
    .map((character) => {
      if (character === '*') return '.*';
      if (character === '?') return '.';
      return character.replaceAll(/[\\^$.*+?()[\]{}|]/g, '\\$&');
    })
    .join('');
  return new RegExp(`^${expression}$`).test(value);
};

/**
 * Confirms that the deterministic tombstone is the only composable template matching the retired
 * physical index. This makes its `allow_auto_create: false` policy the effective winner without
 * taking precedence over templates owned by an operator.
 */
export const assertRetiredIndexProtection = (
  index: string,
  templates: z.infer<typeof indexTemplateListResponseSchema>['index_templates'],
) => {
  const name = getRetiredIndexProtectionTemplateName(index);
  const expected = getRetiredIndexProtectionTemplate(index);
  const named = templates.find((candidate) => candidate.name === name);

  const namedTemplate = named?.index_template;
  const isOwnedAndEffective =
    namedTemplate?._meta?.owner === RETIRED_INDEX_PROTECTION_OWNER &&
    namedTemplate._meta.index === index &&
    namedTemplate.allow_auto_create === false &&
    namedTemplate.priority === RETIRED_INDEX_PROTECTION_PRIORITY &&
    namedTemplate.data_stream === undefined &&
    (namedTemplate.composed_of === undefined || namedTemplate.composed_of.length === 0) &&
    isEmptyRecord(namedTemplate.template ?? {}) &&
    namedTemplate.index_patterns.length === 1 &&
    namedTemplate.index_patterns[0] === expected.index_patterns[0];

  if (named && !isOwnedAndEffective) {
    throw new Error(
      `Elasticsearch index template ${name} already exists but is not owned by LobeHub retirement protection or has drifted`,
    );
  }

  const overlapping = templates.filter(
    (candidate) =>
      candidate.name !== name &&
      candidate.index_template.index_patterns.some((pattern) => wildcardMatches(pattern, index)),
  );
  if (overlapping.length > 0) {
    throw new Error(
      `Retired index ${index} overlaps external index template ${overlapping.map(({ name: candidateName }) => candidateName).join(', ')}; remove or narrow the overlap before purging`,
    );
  }

  return named !== undefined;
};

const isEmptyRecord = (value: Record<string, unknown>) => Object.keys(value).length === 0;
