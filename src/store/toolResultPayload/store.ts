import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import {
  createReplicaSlice,
  createReplicaState,
  recordLens,
  type ReplicaState,
} from '@/libs/replica';
import { messageService } from '@/services/message';
import { type ToolResultPayloadRead, toolResultPayloadResource } from '@/services/message/replica';
import { createDevtools } from '@/store/middleware/createDevtools';
import { expose } from '@/store/middleware/expose';

export interface ToolResultPayloadStoreState {
  /** Message id → the projected tool payload fetched back for it. */
  toolResultPayloadMap: Record<string, ToolResultPayloadRead>;
  toolResultPayloadReplica: ReplicaState<ToolResultPayloadRead>;
}

export const initialToolResultPayloadState: ToolResultPayloadStoreState = {
  toolResultPayloadMap: {},
  toolResultPayloadReplica: createReplicaState(),
};

const createPayloadSlice = (
  set: (partial: Partial<ToolResultPayloadStore>, replace?: false, action?: any) => void,
  get: () => ToolResultPayloadStore,
) =>
  createReplicaSlice(toolResultPayloadResource, {
    actionPrefix: 'toolResultPayload',
    fetcher: async (messageId: string) => ({
      value: await messageService.getToolResultPayload(messageId),
    }),
    get,
    set,
    stateKey: 'toolResultPayloadReplica',
    view: recordLens<ToolResultPayloadStore, ToolResultPayloadRead>('toolResultPayloadMap'),
  });

export interface ToolResultPayloadStore extends ToolResultPayloadStoreState {
  /** @internal The replica slice; read through `useToolResultPayload`. */
  payload: ReturnType<typeof createPayloadSlice>;
}

const devtools = createDevtools('toolResultPayload');

export const useToolResultPayloadStore = createWithEqualityFn<ToolResultPayloadStore>()(
  devtools((set, get) => ({
    ...initialToolResultPayloadState,
    payload: createPayloadSlice(set, get),
  })),
  shallow,
);

expose('toolResultPayload', useToolResultPayloadStore);
