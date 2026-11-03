import type { BuiltinModelIdentifier, EnabledAiModel } from 'model-bank';

import { createReplicaState, type ReplicaState } from '@/libs/replica';
import {
  type AiProviderDetailItem,
  type AiProviderListItem,
  type AiProviderRuntimeConfig,
  type EnabledProvider,
  type EnabledProviderWithModels,
} from '@/types/aiProvider';

import type { AiProviderRuntimeStateView } from './projection';

export interface AIProviderState {
  activeAiProvider?: string;
  activeProviderModelList: any[];
  aiProviderConfigUpdatingIds: string[];
  /**
   * Map of provider id to provider detail, used for caching provider details
   * to avoid data inconsistency when switching providers
   */
  aiProviderDetailMap: Record<string, AiProviderDetailItem>;
  /** Replica bookkeeping of `aiProviderDetailMap`. */
  aiProviderDetailReplica: ReplicaState<AiProviderDetailItem>;
  /** Provider list of the active scope (the replica view). */
  aiProviderList: AiProviderListItem[];
  /** Replica bookkeeping of `aiProviderList`. */
  aiProviderListReplica: ReplicaState<AiProviderListItem[]>;
  aiProviderLoadingIds: string[];
  aiProviderRuntimeConfig: Record<string, AiProviderRuntimeConfig>;
  /** Derived runtime state per entry key, the replica view for the entry map. */
  aiProviderRuntimeStateMap: Record<string, AiProviderRuntimeStateView>;
  /** Replica bookkeeping of `aiProviderRuntimeStateMap`. */
  aiProviderRuntimeStateReplica: ReplicaState<AiProviderRuntimeStateView>;
  enabledAiModels?: EnabledAiModel[];
  enabledAiProviders?: EnabledProvider[];
  enabledAsrModelList?: EnabledProviderWithModels[];
  // used for select
  enabledChatModelList?: EnabledProviderWithModels[];
  enabledEmbeddingModelList?: EnabledProviderWithModels[];
  enabledImageModelList?: EnabledProviderWithModels[];
  enabledVideoModelList?: EnabledProviderWithModels[];
  hiddenBuiltinModels?: BuiltinModelIdentifier[];
  initAiProviderList: boolean;
  isInitAiProviderRuntimeState: boolean;
  /** Retired model id → successor id, delivered with the provider runtime state. */
  modelRedirects?: Record<string, string>;
  /** Secret-free provider → supported local agent binding capabilities. */
  providerBindingAgentTypes: Record<string, string[]>;
  providerSearchKeyword: string;
}

export const initialAIProviderState: AIProviderState = {
  activeProviderModelList: [],
  aiProviderConfigUpdatingIds: [],
  aiProviderDetailMap: {},
  aiProviderDetailReplica: createReplicaState(),
  aiProviderList: [],
  aiProviderListReplica: createReplicaState(),
  aiProviderLoadingIds: [],
  aiProviderRuntimeConfig: {},
  aiProviderRuntimeStateMap: {},
  aiProviderRuntimeStateReplica: createReplicaState(),
  initAiProviderList: false,
  isInitAiProviderRuntimeState: false,
  providerBindingAgentTypes: {},
  providerSearchKeyword: '',
};
