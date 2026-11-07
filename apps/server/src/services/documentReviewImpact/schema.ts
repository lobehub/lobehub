import {
  DOCUMENT_REVIEW_IMPACT_CATEGORIES,
  DOCUMENT_REVIEW_IMPACT_KINDS,
  DOCUMENT_REVIEW_IMPACT_SEVERITIES,
} from '@lobechat/types';
import { z } from 'zod';

import { DocumentImpactError } from './errors';

/**
 * Lenient validation of the model's impact list.
 *
 * Each item is parsed on its own: one malformed entry must not throw away the
 * other findings. A response with no usable item is a schema failure, not an
 * empty analysis — the caller has to tell those apart.
 */
export const ImpactItemDraftSchema = z.object({
  category: z.enum(DOCUMENT_REVIEW_IMPACT_CATEGORIES),
  confidence: z.coerce.number().min(0).max(1).optional(),
  kind: z.enum(DOCUMENT_REVIEW_IMPACT_KINDS),
  reason: z.string().trim().min(1).max(2000),
  relatedLabel: z.string().trim().max(200).optional(),
  relatedQuote: z.string().trim().min(1).max(2000).optional(),
  severity: z.enum(DOCUMENT_REVIEW_IMPACT_SEVERITIES).optional(),
  sourceLabel: z.string().trim().max(200).optional(),
  sourceQuote: z.string().trim().min(1).max(2000),
  title: z.string().trim().min(1).max(200),
  trigger: z.string().trim().max(1000).optional(),
});

export type ImpactItemDraft = z.infer<typeof ImpactItemDraftSchema>;

const asItemArray = (raw: unknown): unknown[] => {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [];

  const record = raw as Record<string, unknown>;
  if (Array.isArray(record.items)) return record.items;

  // Some providers wrap the schema in its name: {"document_review_impacts": {...}}
  const nested = Object.values(record).find(
    (value) => value && typeof value === 'object' && !Array.isArray(value),
  ) as Record<string, unknown> | undefined;
  if (nested && Array.isArray(nested.items)) return nested.items;

  const arrayValue = Object.values(record).find(Array.isArray);
  return Array.isArray(arrayValue) ? arrayValue : [];
};

const parseJson = (raw: unknown): unknown => {
  // Some runtimes double-encode structured output: a JSON string inside JSON.
  let value = raw;
  for (let depth = 0; depth < 2 && typeof value === 'string'; depth += 1) {
    try {
      value = JSON.parse(value);
    } catch (error) {
      throw new DocumentImpactError('SCHEMA_INVALID', '模型返回的内容不是合法 JSON', {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return value;
};

export interface ParsedImpactResponse {
  dropped: number;
  items: ImpactItemDraft[];
}

/** Parse one model response into valid items; throws SCHEMA_INVALID when none survive. */
export const parseImpactAnalysisResponse = (raw: unknown): ParsedImpactResponse => {
  const candidates = asItemArray(parseJson(raw));
  if (candidates.length === 0) {
    throw new DocumentImpactError('SCHEMA_INVALID', '模型没有返回任何影响项', { received: raw });
  }

  const items: ImpactItemDraft[] = [];
  const issues: string[] = [];

  for (const candidate of candidates) {
    const parsed = ImpactItemDraftSchema.safeParse(candidate);
    if (parsed.success) {
      items.push(parsed.data);
    } else {
      issues.push(
        parsed.error.issues
          .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
          .join('; '),
      );
    }
  }

  if (items.length === 0) {
    throw new DocumentImpactError('SCHEMA_INVALID', '模型返回的影响项格式不正确', {
      issues: issues.slice(0, 5),
      receivedCount: candidates.length,
    });
  }

  return { dropped: candidates.length - items.length, items };
};
