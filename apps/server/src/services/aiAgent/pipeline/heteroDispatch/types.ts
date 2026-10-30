import type { LobeChatDatabase } from '@lobechat/database';
import type { HeterogeneousAgentType } from '@lobechat/heterogeneous-agents';
import type {
  HeterogeneousRuntimePinSources,
  HeterogeneousTopicPin,
  LobeAgentAgencyConfig,
  RequestTrigger,
} from '@lobechat/types';

import type { MessageModel } from '@/database/models/message';
import type { TopicModel } from '@/database/models/topic';
import type { AgentHook } from '@/server/services/agentRuntime/hooks/types';
import type { MarketService } from '@/server/services/market';
import type { SandboxSessionConfig } from '@/server/services/sandbox/session';

import type { BindTopicWorkingDirectoryParams, InternalExecAgentParams } from '../../types';
import type { RunAttachments } from '../turnSetup';

export interface HeteroDispatchDeps {
  bindTopicWorkingDirectory: (params: BindTopicWorkingDirectoryParams) => Promise<void>;
  db: LobeChatDatabase;
  /**
   * With a `sandboxStorage` claim, a service whose trust token carries the
   * entitlement a persistent sandbox run needs — built for that run rather
   * than taken from the cache, because the claim is signed into the token.
   */
  getMarketService: (options?: {
    sandboxStorage: NonNullable<SandboxSessionConfig['claim']>;
  }) => Promise<MarketService>;
  messageModel: MessageModel;
  resolveDeviceWorkspaceId: (deviceId: string | undefined) => Promise<string | undefined>;
  topicModel: TopicModel;
  userId: string;
  withholdGatewayToken: boolean;
  workspaceId?: string;
}

export interface HeteroDispatchInput {
  canManageAgent: boolean;
  effectiveRequestedDeviceId?: string;
  heterogeneousProvider?: LobeAgentAgencyConfig['heterogeneousProvider'];
  heteroType: HeterogeneousAgentType;
  hooks?: AgentHook[];
  isPublicWorkspaceAgent: boolean;
  localDeviceId?: string;
  maxSteps?: number;
  memberDeviceOverride?: Pick<LobeAgentAgencyConfig, 'boundDeviceId' | 'executionTarget'>;
  onOperationCreated?: InternalExecAgentParams['onOperationCreated'];
  operationTaskId?: string;
  parentOperationId?: string;
  pinnedHeterogeneousTopicModel?: HeterogeneousTopicPin;
  /** Which layer supplied each pin; see `TurnSetupResult`. */
  pinnedHeterogeneousTopicSources?: HeterogeneousRuntimePinSources;
  requestedDeviceId?: string;
  requestTrigger?: RequestTrigger;
  reservedOperationId?: string;
  runAttachments: Pick<RunAttachments, 'audioList' | 'fileList' | 'imageList' | 'videoList'>;
  /** Ids of the rows THIS turn just persisted (excluded from recovery history). */
  selfMessageIds: Set<string>;
  topicStartOwnerOperationId?: string;
}

/** The identity every terminal result and dispatch failure of one run carries. */
export interface HeteroRun {
  agentId: string;
  assistantMessageId: string;
  operationId: string;
  topicId: string;
  /** `userMessageId ?? parentMessageId ?? ''`, as every result reports it. */
  userMessageId: string;
}
