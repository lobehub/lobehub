import { DEFAULT_PROVIDER } from '@lobechat/business-const';
import { DEFAULT_MODEL, DEFAUTT_AGENT_TTS_CONFIG, isDesktop } from '@lobechat/const';
import { type AgentBuilderContext } from '@lobechat/context-engine';
import {
  type AgentMode,
  type LobeAgentAgencyConfig,
  type LobeAgentTTSConfig,
  type RuntimeEnvConfig,
} from '@lobechat/types';

import { resolveTargetDeviceId } from '@/helpers/agentWorkingDirectory';
import { globalAgentContextManager } from '@/helpers/GlobalAgentContextManager';

import { type AgentStoreState } from '../initialState';
import { agentSelectors } from './selectors';

/**
 * Selectors that get agent config by agentId parameter.
 * Used in ChatInput components where agentId is passed as prop.
 */

const getAgentModelById =
  (agentId: string) =>
  (s: AgentStoreState): string =>
    agentSelectors.getAgentConfigById(agentId)(s)?.model || DEFAULT_MODEL;

const getAgentModelProviderById =
  (agentId: string) =>
  (s: AgentStoreState): string =>
    agentSelectors.getAgentConfigById(agentId)(s)?.provider || DEFAULT_PROVIDER;

const getAgentPluginsById =
  (agentId: string) =>
  (s: AgentStoreState): string[] =>
    agentSelectors.getAgentConfigById(agentId)(s)?.plugins || [];

const getAgentSystemRoleById =
  (agentId: string) =>
  (s: AgentStoreState): string | undefined =>
    agentSelectors.getAgentConfigById(agentId)(s)?.systemRole;

const getAgentTTSById =
  (agentId: string) =>
  (s: AgentStoreState): LobeAgentTTSConfig =>
    agentSelectors.getAgentConfigById(agentId)(s)?.tts || DEFAUTT_AGENT_TTS_CONFIG;

const getAgentTTSVoiceById =
  (agentId: string) =>
  (s: AgentStoreState): string =>
    getAgentTTSById(agentId)(s).voice?.openai || 'alloy';

const getAgentConfigErrorById =
  (agentId: string) =>
  (s: AgentStoreState): string | undefined =>
    agentId ? s.agentConfigErrorMap[agentId] : undefined;

const getAgentFilesById = (agentId: string) => (s: AgentStoreState) =>
  agentSelectors.getAgentConfigById(agentId)(s)?.files || [];

const getAgentKnowledgeBasesById = (agentId: string) => (s: AgentStoreState) =>
  agentSelectors.getAgentConfigById(agentId)(s)?.knowledgeBases || [];

const isAgentConfigLoadingById = (agentId: string) => (s: AgentStoreState) =>
  !agentId || !s.agentMap[agentId];

/**
 * Get agent mode by agentId.
 * Agent mode is the default — only an explicit `chatConfig.enableAgentMode === false`
 * collapses the agent to chat mode.
 */
const getAgentModeById =
  (agentId: string) =>
  (s: AgentStoreState): AgentMode | undefined => {
    const config = agentSelectors.getAgentConfigById(agentId)(s);
    const chatConfig = config?.chatConfig;
    return chatConfig?.enableAgentMode === false ? undefined : 'auto';
  };

/**
 * Check if agent mode is enabled by agentId.
 * Defaults to true; only explicit `chatConfig.enableAgentMode === false` returns false.
 */
const getAgentEnableModeById =
  (agentId: string) =>
  (s: AgentStoreState): boolean => {
    const config = agentSelectors.getAgentConfigById(agentId)(s);
    const chatConfig = config?.chatConfig;
    return chatConfig?.enableAgentMode !== false;
  };

/**
 * Get runtime env config by agentId
 * Now reads from chatConfig.runtimeEnv
 */
const getAgentRuntimeEnvConfigById =
  (agentId: string) =>
  (s: AgentStoreState): RuntimeEnvConfig | undefined =>
    agentSelectors.getAgentConfigById(agentId)(s)?.chatConfig?.runtimeEnv;

/**
 * Get the agent-level working directory by agentId.
 *
 * Precedence (the agent-owned slice only — topic overrides and device defaults
 * are layered on by callers):
 *
 *   agent's per-device choice (`agencyConfig.workingDirByDevice[targetDeviceId]`)
 *     > legacy per-agent localStorage value (pre-migration fallback)
 *     > desktop path > home path
 *
 * `currentDeviceId` is passed in (not read cross-store) so hook callers stay
 * reactive to device changes. The target device is resolved from it via
 * `resolveTargetDeviceId`, so a device-bound agent reads its bound device's
 * choice rather than the local machine's.
 */
const getAgentWorkingDirectoryById =
  (agentId: string, currentDeviceId?: string) =>
  (s: AgentStoreState): string | undefined => {
    if (!isDesktop) return;

    const ctx = globalAgentContextManager.getContext();
    const agencyConfig = agentSelectors.getAgentConfigById(agentId)(s)?.agencyConfig;
    const targetDeviceId = resolveTargetDeviceId(agencyConfig, currentDeviceId);
    const agentChoice = targetDeviceId
      ? agencyConfig?.workingDirByDevice?.[targetDeviceId]
      : undefined;

    return (
      agentChoice ?? s.localAgentWorkingDirectoryMap[agentId] ?? ctx.desktopPath ?? ctx.homePath
    );
  };

/**
 * Get agent builder context by agentId
 * Used for injecting current agent config/meta into Agent Builder context
 */
const getAgentBuilderContextById =
  (agentId: string) =>
  (s: AgentStoreState): AgentBuilderContext => {
    const config = agentSelectors.getAgentConfigById(agentId)(s);
    const meta = agentSelectors.getAgentMetaById(agentId)(s);

    return {
      config: {
        chatConfig: config?.chatConfig,
        model: config?.model,
        openingMessage: config?.openingMessage,
        openingQuestions: config?.openingQuestions,
        params: config?.params,
        plugins: config?.plugins,
        provider: config?.provider,
        systemRole: config?.systemRole,
      },
      meta,
    };
  };

/**
 * Get agencyConfig by agentId
 */
const getAgencyConfigById =
  (agentId: string) =>
  (s: AgentStoreState): LobeAgentAgencyConfig | undefined =>
    agentSelectors.getAgentConfigById(agentId)(s)?.agencyConfig;

/**
 * Whether the agent is driven by an external heterogeneous runtime
 * (e.g. Claude Code) — by agentId.
 */
const isAgentHeterogeneousById =
  (agentId: string) =>
  (s: AgentStoreState): boolean =>
    !!getAgencyConfigById(agentId)(s)?.heterogeneousProvider;

/**
 * Get full agent data by agentId
 * Returns the complete agent object including metadata fields like updatedAt
 */
const getAgentById = (agentId: string) => (s: AgentStoreState) => s.agentMap[agentId];

export const agentByIdSelectors = {
  getAgencyConfigById,
  getAgentBuilderContextById,
  getAgentById,
  getAgentConfigById: agentSelectors.getAgentConfigById,
  getAgentConfigErrorById,
  getAgentEnableModeById,
  getAgentFilesById,
  getAgentKnowledgeBasesById,
  getAgentRuntimeEnvConfigById,
  getAgentModeById,
  getAgentModelById,
  getAgentModelProviderById,
  getAgentPluginsById,
  getAgentSystemRoleById,
  getAgentTTSById,
  getAgentTTSVoiceById,
  getAgentWorkingDirectoryById,
  isAgentConfigLoadingById,
  isAgentHeterogeneousById,
};
