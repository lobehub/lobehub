import type {
  AgentEvalMemoryItem,
  EvalMemoryEntry,
  EvalMemoryFixture,
  EvalMemoryLayer,
} from '@lobechat/types';

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

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

/**
 * The text an entry's vector is built from: the one field of its layer the
 * account's Memory embeds and searches (a preference's directives, an
 * activity's narrative, a context's or identity's description), so the same
 * query ranks the entry where the account's search would. A persona has no
 * vector; it is injected, never searched.
 */
export const semanticText = (
  draft: Pick<EvalMemoryDraft, 'layer' | 'payload'>,
): string | undefined => {
  const p = draft.payload as Item;
  switch (draft.layer) {
    case 'preference': {
      return text(p.conclusionDirectives);
    }
    case 'activity': {
      return text(p.narrative);
    }
    case 'context':
    case 'identity': {
      return text(p.description);
    }
    case 'experience': {
      return text(p.situation);
    }
    default: {
      return undefined;
    }
  }
};

const stringList = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : undefined;

/**
 * The tags an entry is filtered and ranked by. The account's Memory stores an
 * activity's `withActivity.tags` (when given) on both its rows and drops the
 * item's own tags; every other layer keeps the item's tags.
 */
export const tagsOf = (row: Pick<AgentEvalMemoryItem, 'layer' | 'payload' | 'tags'>): string[] =>
  (row.layer === 'activity' ? stringList((row.payload as Item).tags) : undefined) ?? row.tags ?? [];

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
