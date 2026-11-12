import type { EntityPreviewState } from './initialState';
import { type EntityPreview, entityPreviewKey, type EntityPreviewParams } from './projection';

/** One entity's preview, or `undefined` before its first paint (or once it is gone). */
const getPreview =
  (params?: EntityPreviewParams | null) =>
  (s: EntityPreviewState): EntityPreview | undefined =>
    params ? s.entityPreviewMap[entityPreviewKey(params)] : undefined;

/**
 * Whether the server answered this preview in this session. A restored copy
 * still paints the title and description, but its statuses and counts may
 * have moved on since, so they wait for this.
 */
const isPreviewConfirmed =
  (params?: EntityPreviewParams | null) =>
  (s: EntityPreviewState): boolean =>
    !!params && s.entityPreviewReplica.entries[entityPreviewKey(params)]?.source === 'server';

export const entityPreviewSelectors = {
  getPreview,
  isPreviewConfirmed,
};
