import type { EvalMemoryEntry, EvalMemoryFixture, EvalMemoryLayer } from '@lobechat/types';

import type { AgentEvalMemoryItem } from '@/database/schemas';

/** What a Memory entry is made of before it has an id, a clock and an embedding. */
export interface EvalMemoryDraft {
  details?: string | null;
  layer: EvalMemoryLayer;
  memoryCategory?: string | null;
  memoryType?: string | null;
  payload: Record<string, unknown>;
  summary?: string | null;
  tags?: string[] | null;
  title?: string | null;
}

type Item = Record<string, any>;

/** A Memory tool item (`title`, `summary`, … plus its `withX` part) as a draft. */
export const draftOf = (
  layer: EvalMemoryLayer,
  item: Item,
  payloadKey: string,
): EvalMemoryDraft => ({
  details: item.details ?? null,
  layer,
  memoryCategory: item.memoryCategory ?? null,
  memoryType: item.memoryType ?? null,
  payload: (item[payloadKey] ?? {}) as Record<string, unknown>,
  summary: item.summary ?? null,
  tags: Array.isArray(item.tags) ? item.tags : null,
  title: item.title ?? null,
});

/** The case fixture as drafts: its persona first, then every layer's items in order. */
export const fixtureDrafts = (fixture: EvalMemoryFixture): EvalMemoryDraft[] => [
  ...(fixture.persona
    ? [
        {
          layer: 'persona' as const,
          payload: { narrative: fixture.persona.narrative, tagline: fixture.persona.tagline },
          summary: fixture.persona.narrative,
          title: fixture.persona.tagline ?? null,
        },
      ]
    : []),
  ...(fixture.preferences ?? []).map((item) => draftOf('preference', item, 'withPreference')),
  ...(fixture.contexts ?? []).map((item) => draftOf('context', item, 'withContext')),
  ...(fixture.activities ?? []).map((item) => draftOf('activity', item, 'withActivity')),
  ...(fixture.experiences ?? []).map((item) => draftOf('experience', item, 'withExperience')),
  ...(fixture.identities ?? []).map((item) => draftOf('identity', item, 'withIdentity')),
];

const text = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value.trim() || undefined;
  if (Array.isArray(value))
    return value.filter((v) => typeof v === 'string').join('\n') || undefined;
  return undefined;
};

/** The text an entry is found by: its headline fields and the layer's own prose. */
export const draftText = (
  draft: Pick<EvalMemoryDraft, 'details' | 'payload' | 'summary' | 'title'>,
) => {
  const p = draft.payload as Item;
  return [
    draft.title,
    draft.summary,
    draft.details,
    p.narrative,
    p.description,
    p.conclusionDirectives,
    p.suggestions,
    p.situation,
    p.action,
    p.keyLearning,
    p.feedback,
    p.notes,
  ]
    .map(text)
    .filter((v): v is string => !!v)
    .join('\n');
};

export const toEntry = (row: AgentEvalMemoryItem): EvalMemoryEntry => ({
  capturedAt: row.capturedAt.toISOString(),
  details: row.details,
  id: row.id,
  layer: row.layer,
  memoryCategory: row.memoryCategory,
  memoryType: row.memoryType,
  payload: row.payload,
  removedReason: row.removedReason,
  source: row.source,
  summary: row.summary,
  tags: row.tags,
  title: row.title,
});
