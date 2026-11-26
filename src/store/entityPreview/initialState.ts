import { createReplicaState, type ReplicaState } from '@/libs/replica';

import type { EntityPreview } from './projection';

export interface EntityPreviewState {
  /** Linked entity previews (`entityPreviewMap[entityPreviewKey(params)]`). */
  entityPreviewMap: Record<string, EntityPreview>;
  /**
   * Entities the server answered as gone (or no longer visible), by entry key,
   * with the cache scope that answer belongs to. Memory only: it stops the link
   * from falling back to a title another surface loaded before.
   */
  entityPreviewMissing: Record<string, string>;
  /** Replica bookkeeping for `entityPreviewMap`. */
  entityPreviewReplica: ReplicaState<EntityPreview>;
}

export const initialState: EntityPreviewState = {
  entityPreviewMap: {},
  entityPreviewMissing: {},
  entityPreviewReplica: createReplicaState(),
};
