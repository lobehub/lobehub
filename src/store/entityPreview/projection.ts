import type { GoalStatus } from '@lobechat/const/goal';

import { defineReplica } from '@/libs/replica';

/** Entities an internal link can name and preview (every reference type but `route`). */
export type EntityPreviewType = 'acceptance' | 'agent' | 'document' | 'goal' | 'task' | 'verify';

export interface EntityPreviewParams {
  id: string;
  type: EntityPreviewType;
}

/**
 * The compact preview of one linked entity: what the link label and its hover
 * card paint. Counts and statuses are kept raw, so the card formats them in
 * the current language instead of replaying the strings of an older session.
 */
export interface EntityPreview {
  acceptance?: { exceptions: number; passed: number; rounds: number; total: number };
  avatar?: string | null;
  backgroundColor?: string | null;
  description?: string | null;
  goal?: { done: number; pendingDecisions: number; status: GoalStatus; total: number };
  title?: string | null;
  verify?: {
    branch?: string | null;
    commit?: string | null;
    counts?: { failed: number; passed: number; uncertain: number };
    status?: string | null;
    testedAt?: string | null;
  };
}

/** Linked entities whose preview survives a reload, most recently used first. */
export const MAX_PERSISTED_ENTITY_PREVIEWS = 100;

/** The card clamps the description to three lines; longer text is never shown. */
export const ENTITY_PREVIEW_DESCRIPTION_LIMIT = 280;

/**
 * Entry key: `<type>/<id>`. The `/` keeps the SWR sync key clear of the legacy
 * CACHE_TIERS prefixes (`task:`, `agent:`, `document:`), which would persist
 * the response a second time.
 */
export const entityPreviewKey = ({ id, type }: EntityPreviewParams) => `${type}/${id}`;

/**
 * Previews of the entities internal links point at (`entityPreviewMap[key]`).
 * localStorage, not IndexedDB: a mounted link restores its title inside the
 * mount microtask, so a reload paints the title instead of flashing the URL.
 * Entries are compact and LRU-capped to stay well inside the origin quota.
 */
export const entityPreviewResource = defineReplica<
  EntityPreviewParams,
  EntityPreview,
  EntityPreview | null
>({
  key: entityPreviewKey,
  name: 'entityPreview',
  persist: { maxEntries: MAX_PERSISTED_ENTITY_PREVIEWS },
  storage: 'localStorage',
  version: 1,
});

export const clipDescription = (text: string | null | undefined) =>
  text ? text.slice(0, ENTITY_PREVIEW_DESCRIPTION_LIMIT) : text;
