import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import {
  createReplicaSlice,
  createReplicaState,
  defineReplica,
  recordLens,
  type ReplicaState,
} from '@/libs/replica';
import { deviceService } from '@/services/device';
import { createDevtools } from '@/store/middleware/createDevtools';
import { expose } from '@/store/middleware/expose';

/**
 * The native runtimes of the connection an agent run on a device reaches
 * (`device.getAgentRunRuntimes`), e.g. `codex-collaboration-mode-v1` for the
 * Codex Plan switch. Keyed by device id inside the cache scope (user +
 * workspace); a reload paints the last answer and the probe confirms it.
 */
export const agentRunRuntimesResource = defineReplica<string, string[]>({
  key: (deviceId) => deviceId,
  name: 'deviceAgentRunRuntimes',
  persist: { maxEntries: 20 },
  storage: 'indexedDB',
  version: 1,
});

interface AgentRunRuntimesStoreState {
  agentRunRuntimesMap: Record<string, string[]>;
  agentRunRuntimesReplica: ReplicaState<string[]>;
}

const createSlice = (
  set: (partial: Partial<AgentRunRuntimesStore>, replace?: false, action?: any) => void,
  get: () => AgentRunRuntimesStore,
) =>
  createReplicaSlice(agentRunRuntimesResource, {
    actionPrefix: 'agentRunRuntimes',
    fetcher: async (deviceId: string) =>
      (await deviceService.getAgentRunRuntimes({ deviceId })).runtimes,
    get,
    set,
    stateKey: 'agentRunRuntimesReplica',
    view: recordLens<AgentRunRuntimesStore, string[]>('agentRunRuntimesMap'),
  });

interface AgentRunRuntimesStore extends AgentRunRuntimesStoreState {
  /** @internal The replica slice; read through `useAgentRunRuntimes`. */
  slice: ReturnType<typeof createSlice>;
}

const devtools = createDevtools('agentRunRuntimes');

export const useAgentRunRuntimesStore = createWithEqualityFn<AgentRunRuntimesStore>()(
  devtools((set, get) => ({
    agentRunRuntimesMap: {},
    agentRunRuntimesReplica: createReplicaState(),
    slice: createSlice(set, get),
  })),
  shallow,
);

expose('agentRunRuntimes', useAgentRunRuntimesStore);

const SYNC_OPTIONS = { dedupingInterval: 60 * 1000, revalidateOnFocus: false };

/** The device's agent-run runtimes, or undefined while unknown (or without a device). */
export const useAgentRunRuntimes = (deviceId: string | undefined): string[] | undefined => {
  const data = useAgentRunRuntimesStore((s) =>
    deviceId ? s.agentRunRuntimesMap[deviceId] : undefined,
  );
  useAgentRunRuntimesStore.getState().slice.useSync(deviceId ?? null, SYNC_OPTIONS);
  return data;
};
