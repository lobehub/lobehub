import type { LinkPreview } from '@lobechat/types';

import { createReplicaState, type ReplicaState } from '@/libs/replica';

export interface LinkPreviewState {
  /** Link cards (`linkPreviewMap[linkPreviewKey(params)]`). */
  linkPreviewMap: Record<string, LinkPreview>;
  /** Replica bookkeeping for `linkPreviewMap`. */
  linkPreviewReplica: ReplicaState<LinkPreview>;
}

export const initialState: LinkPreviewState = {
  linkPreviewMap: {},
  linkPreviewReplica: createReplicaState(),
};
