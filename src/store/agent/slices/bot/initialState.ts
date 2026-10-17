import { createReplicaState, type ReplicaState } from '@/libs/replica';
import type { SerializedPlatformDefinition } from '@/server/services/bot/platforms/types';

import type { BotProviderItem } from './projection';

export interface BotSliceState {
  /** Server channel platform catalog (single entry), read by the channel page. */
  botPlatformDefinitions?: SerializedPlatformDefinition[];
  /** Replica bookkeeping of `botPlatformDefinitions`. */
  botPlatformDefinitionsReplica: ReplicaState<SerializedPlatformDefinition[]>;
  /** Replica view of each agent's channel providers, keyed by agent id. */
  botProvidersMap: Record<string, BotProviderItem[]>;
  /** Replica bookkeeping of `botProvidersMap`. */
  botProvidersReplica: ReplicaState<BotProviderItem[]>;
}

export const initialBotSliceState: BotSliceState = {
  botPlatformDefinitions: undefined,
  botPlatformDefinitionsReplica: createReplicaState(),
  botProvidersMap: {},
  botProvidersReplica: createReplicaState(),
};
