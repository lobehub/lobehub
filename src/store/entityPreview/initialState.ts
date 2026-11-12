import { createReplicaState, type ReplicaState } from '@/libs/replica';

import type { EntityPreview } from './projection';

export interface EntityPreviewState {
  /** Linked entity previews (`entityPreviewMap[entityPreviewKey(params)]`). */
  entityPreviewMap: Record<string, EntityPreview>;
  /** Replica bookkeeping for `entityPreviewMap`. */
  entityPreviewReplica: ReplicaState<EntityPreview>;
}

export const initialState: EntityPreviewState = {
  entityPreviewMap: {},
  entityPreviewReplica: createReplicaState(),
};
