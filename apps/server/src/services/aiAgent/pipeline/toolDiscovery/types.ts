import type { DeviceAttachment } from '@lobechat/builtin-tool-remote-device';
import type {
  AgentGroupConfig,
  LobeToolManifest,
  ToolExecutor,
  ToolsEngine,
  ToolSource,
} from '@lobechat/context-engine';
import type { LobeChatDatabase } from '@lobechat/database';
import type {
  ChatTopicBotContext,
  FrozenCredentialFacts,
  FrozenModelFacts,
  RequestTrigger,
} from '@lobechat/types';
import type { ModelAbilities } from 'model-bank';

import type { loadModels } from '@/business/client/model-bank/loadModels';
import type { ConnectorModel } from '@/database/models/connector';
import type { ConnectorToolModel } from '@/database/models/connectorTool';
import type { MessageModel } from '@/database/models/message';
import type { PluginModel } from '@/database/models/plugin';
import type { ExecutionPlan } from '@/helpers/executionTarget';
import type { buildConnectorManifests } from '@/libs/mcp/buildConnectorManifests';
import type { AgentDocumentsService } from '@/server/services/agentDocuments';
import type { ComposioService } from '@/server/services/composio';
import type { MarketService } from '@/server/services/market';

import type { resolveServerSearchDecision } from '../../searchDecision';
import type { InternalExecAgentParams } from '../../types';

export interface ToolDiscoveryDeps {
  agentDocumentsService: AgentDocumentsService;
  composioService: ComposioService;
  connectorModel: ConnectorModel;
  connectorToolModel: ConnectorToolModel;
  db: LobeChatDatabase;
  getMarketService: () => Promise<MarketService>;
  messageModel: MessageModel;
  pluginModel: PluginModel;
  userId: string;
  workspaceId?: string;
}

export interface ToolDiscoveryInput {
  additionalPluginIds?: string[];
  agentSlug?: string | null;
  attachedFileIds?: string[];
  botContext?: ChatTopicBotContext;
  /** Tri-state disabled plugin identifiers captured before pinned-id collapse. */
  disabledPluginIds: string[];
  disableLocalSystem?: boolean;
  disableSelfFeedbackIntentTool?: boolean;
  disableTools?: boolean;
  discordContext?: any;
  exclusivePluginIds?: string[];
  /**
   * Mime types of the raw bot/IM uploads. The stage only ever looked at the
   * mime type, and keeping the request JSON-safe is what lets a deferred init
   * carry it on the operation state.
   */
  externalFileTypes?: string[];
  functionTools?: InternalExecAgentParams['functionTools'];
  globalMemoryEnabled: boolean;
  hasMentionedAgents: boolean;
  isFixedDeviceTarget: boolean;
  /** Shared lazy history loader — also consumed by the caller after discovery. */
  loadHistoryMessages: () => Promise<any[]>;
  localDeviceId?: string;
  requestedDeviceId?: string;
  requestTrigger?: RequestTrigger;
  /** See `AgentRunInitRequest.requireDevice`. */
  requireDevice?: boolean;
  selectedToolIds?: string[];
  throwIfExecutionAborted: (stage: string) => Promise<void>;
  topicBoundDeviceId?: string | null;
}

export interface ToolDiscoveryResult {
  activeDeviceId?: string;
  activeDeviceScope?: 'personal' | 'workspace';
  agentPlugins: string[];
  builtinModels: Awaited<ReturnType<typeof loadModels>>;
  composioManifests: LobeToolManifest[];
  connectorManifests: ReturnType<typeof buildConnectorManifests>;
  /**
   * Tells the model whose connected account each borrowed tool runs on. Run
   * context: it travels on the operation and the context engine injects it.
   */
  connectorOwnershipNote?: string;
  /**
   * Credentials listed once for the whole operation; see
   * {@link FrozenCredentialFacts}. Absent when the run cannot inject
   * credentials.
   *
   * Deliberately still a promise: awaiting it here would put a Market round
   * trip between tool discovery and operation preparation, on the path to the
   * first token. The caller awaits it once the preparation it overlaps with is
   * done. Never rejects — a failed read resolves to `undefined` and the run
   * reads the list live, as it did before the snapshot existed.
   */
  credentialFactsPromise?: Promise<FrozenCredentialFacts | undefined>;
  executionPlan?: ExecutionPlan;
  hasAgentDocuments: boolean;
  hasEnabledKnowledgeBases: boolean;
  lobehubSkillManifests: LobeToolManifest[];
  /** Model facts read once for the whole operation; see {@link FrozenModelFacts}. */
  modelFacts: FrozenModelFacts;
  modelMediaCapabilities: Pick<ModelAbilities, 'audio' | 'video' | 'vision'>;
  onlineDevices: DeviceAttachment[];
  operationAgentGroup?: AgentGroupConfig;
  searchDecision: ReturnType<typeof resolveServerSearchDecision>;
  toolExecutorMap: Record<string, ToolExecutor>;
  toolManifestMap: Record<string, any>;
  tools?: any[];
  toolsEngine?: ToolsEngine;
  toolSourceMap: Record<string, ToolSource>;
  toolsResult: { enabledToolIds: string[]; tools?: any[] | undefined };
}
