import { DEFAULT_PROVIDER } from '@lobechat/business-const';
import {
  DEFAULT_AGENT_CONFIG,
  DEFAULT_AVATAR,
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_INBOX_AVATAR,
  DEFAULT_MODEL,
  DEFAUTT_AGENT_TTS_CONFIG,
  isDesktop,
} from '@lobechat/const';
import {
  type AgentMode,
  type KnowledgeItem,
  type LobeAgentConfig,
  type LobeAgentTTSConfig,
  type MetaData,
  type RuntimeEnvConfig,
} from '@lobechat/types';
import { KnowledgeType } from '@lobechat/types';
import { VoiceList } from '@lobehub/tts';

import { DEFAULT_OPENING_QUESTIONS } from '@/features/AgentSetting/store/selectors';
import { resolveTargetDeviceId } from '@/helpers/agentWorkingDirectory';
import { globalAgentContextManager } from '@/helpers/GlobalAgentContextManager';
import { filterToolIds } from '@/helpers/toolFilters';

import { type AgentStoreState } from '../initialState';
import { builtinAgentSelectors } from './builtinAgentSelectors';

// ==========   Meta   ============== //

const currentAgentData = (s: AgentStoreState) =>
  s.activeAgentId ? s.agentMap[s.activeAgentId] : undefined;

const currentAgentTitle = (s: AgentStoreState) => currentAgentData(s)?.title;

const getDefaultAvatarByAgentId = (s: AgentStoreState, agentId?: string) => {
  const inboxAgentId = builtinAgentSelectors.inboxAgentId(s);

  return agentId && inboxAgentId === agentId ? DEFAULT_INBOX_AVATAR : DEFAULT_AVATAR;
};

const currentAgentAvatar = (s: AgentStoreState) =>
  currentAgentData(s)?.avatar || getDefaultAvatarByAgentId(s, s.activeAgentId);

const currentAgentDescription = (s: AgentStoreState) => currentAgentData(s)?.description;

const currentAgentBackgroundColor = (s: AgentStoreState) =>
  currentAgentData(s)?.backgroundColor || 'transparent';

const currentAgentTags = (s: AgentStoreState) => currentAgentData(s)?.tags || [];

/**
 * Get complete meta data for the current agent
 * Used to replace sessionMetaSelectors.currentAgentMeta
 */
const currentAgentMeta = (s: AgentStoreState): MetaData => {
  const data = currentAgentData(s);
  return {
    avatar: data?.avatar || getDefaultAvatarByAgentId(s, s.activeAgentId),
    backgroundColor: data?.backgroundColor || DEFAULT_BACKGROUND_COLOR,
    description: data?.description || undefined,
    marketIdentifier: data?.marketIdentifier || undefined,
    tags: data?.tags,
    title: data?.title || undefined,
  };
};

/**
 * Get agent meta by agent ID (for group chat)
 * Used to replace sessionMetaSelectors.getAgentMetaByAgentId
 */
const getAgentMetaById =
  (agentId: string) =>
  (s: AgentStoreState): MetaData => {
    const data = s.agentMap[agentId];
    if (!data) return {};

    return {
      avatar: data.avatar || getDefaultAvatarByAgentId(s, agentId),
      backgroundColor: data.backgroundColor || DEFAULT_BACKGROUND_COLOR,
      description: data.description || undefined,
      marketIdentifier: data.marketIdentifier || undefined,
      tags: data.tags,
      title: data.title || undefined,
    };
  };

// ==========   Config   ============== //

const inboxAgentConfig = (s: AgentStoreState) => {
  const id = builtinAgentSelectors.inboxAgentId(s);
  // Server returns inbox config already merged with DEFAULT_AGENT_CONFIG and serverDefaultAgentConfig,
  // so we can directly use it. Fallback to DEFAULT_AGENT_CONFIG if not initialized yet.
  return id ? (s.agentMap[id] as LobeAgentConfig) : DEFAULT_AGENT_CONFIG;
};
const inboxAgentModel = (s: AgentStoreState) => inboxAgentConfig(s).model;

const getAgentConfigById =
  (agentId: string) =>
  (s: AgentStoreState): LobeAgentConfig =>
    s.agentMap[agentId] as LobeAgentConfig;

export const currentAgentConfig = (s: AgentStoreState): LobeAgentConfig =>
  getAgentConfigById(s.activeAgentId || '')(s);

const currentAgentSystemRole = (s: AgentStoreState) => {
  return currentAgentConfig(s)?.systemRole;
};

const currentAgentModel = (s: AgentStoreState): string => {
  const config = currentAgentConfig(s);

  return config?.model || DEFAULT_MODEL;
};

const currentAgentModelProvider = (s: AgentStoreState) => {
  const config = currentAgentConfig(s);

  return config?.provider || DEFAULT_PROVIDER;
};

const currentAgentPlugins = (s: AgentStoreState) => {
  const config = currentAgentConfig(s);

  return config?.plugins || [];
};

/**
 * Get displayable agent plugins by filtering out platform-specific tools
 * that shouldn't be shown in the current environment
 */
const displayableAgentPlugins = (s: AgentStoreState) => {
  const plugins = currentAgentPlugins(s);
  return filterToolIds(plugins);
};

const currentAgentKnowledgeBases = (s: AgentStoreState) => {
  const config = currentAgentConfig(s);

  return config?.knowledgeBases || [];
};

const currentAgentFiles = (s: AgentStoreState) => {
  const config = currentAgentConfig(s);

  return config?.files || [];
};

const currentAgentTTS = (s: AgentStoreState): LobeAgentTTSConfig => {
  const config = currentAgentConfig(s);

  return config?.tts || DEFAUTT_AGENT_TTS_CONFIG;
};

const currentAgentTTSVoice =
  (lang: string) =>
  (s: AgentStoreState): string => {
    const { voice, ttsService } = currentAgentTTS(s);
    const voiceList = new VoiceList(lang);
    let currentVoice;
    switch (ttsService) {
      case 'openai': {
        currentVoice = voice.openai || (VoiceList.openaiVoiceOptions?.[0].value as string);
        break;
      }
      case 'edge': {
        currentVoice = voice.edge || (voiceList.edgeVoiceOptions?.[0].value as string);
        break;
      }
      case 'microsoft': {
        currentVoice = voice.microsoft || (voiceList.microsoftVoiceOptions?.[0].value as string);
        break;
      }
    }
    return currentVoice || 'alloy';
  };

const currentEnabledKnowledge = (s: AgentStoreState) => {
  const knowledgeBases = currentAgentKnowledgeBases(s);
  const files = currentAgentFiles(s);

  return [
    ...files
      .filter((f) => f.enabled)
      .map((f) => ({ fileType: f.type, id: f.id, name: f.name, type: KnowledgeType.File })),
    ...knowledgeBases
      .filter((k) => k.enabled)
      .map((k) => ({ id: k.id, name: k.name, type: KnowledgeType.KnowledgeBase })),
  ] as KnowledgeItem[];
};

const hasSystemRole = (s: AgentStoreState) => {
  const config = currentAgentConfig(s);

  return !!config?.systemRole;
};

const hasKnowledgeBases = (s: AgentStoreState) => {
  const knowledgeBases = currentAgentKnowledgeBases(s);

  return knowledgeBases.length > 0;
};

const hasFiles = (s: AgentStoreState) => {
  const files = currentAgentFiles(s);

  return files.length > 0;
};

const hasKnowledge = (s: AgentStoreState) => hasKnowledgeBases(s) || hasFiles(s);
const hasEnabledKnowledge = (s: AgentStoreState) => currentEnabledKnowledge(s).length > 0;
const hasEnabledKnowledgeBases = (s: AgentStoreState) =>
  currentAgentKnowledgeBases(s).some((s) => s.enabled);

const currentKnowledgeIds = (s: AgentStoreState) => {
  return {
    fileIds: currentAgentFiles(s)
      .filter((item) => item.enabled)
      .map((f) => f.id),
    knowledgeBaseIds: currentAgentKnowledgeBases(s)
      .filter((item) => item.enabled)
      .map((k) => k.id),
  };
};

const isAgentConfigLoading = (s: AgentStoreState) =>
  !s.activeAgentId || !s.agentMap[s.activeAgentId];

/**
 * Fetch error for the active agent's config (undefined when none).
 * Distinguishes "fetch failed" from `isAgentConfigLoading`'s "no data yet",
 * so failure surfaces a retry UI instead of an endless skeleton.
 */
const currentAgentConfigError = (s: AgentStoreState): string | undefined =>
  s.activeAgentId ? s.agentConfigErrorMap[s.activeAgentId] : undefined;

const isAgentConfigError = (s: AgentStoreState) => !!currentAgentConfigError(s);

/**
 * Get agent's slug by ID (used to identify builtin agents)
 */
const getAgentSlugById = (agentId: string) => (s: AgentStoreState) => s.agentMap[agentId]?.slug;

const openingQuestions = (s: AgentStoreState) =>
  currentAgentConfig(s)?.openingQuestions || DEFAULT_OPENING_QUESTIONS;
const openingMessage = (s: AgentStoreState) => currentAgentConfig(s)?.openingMessage || '';

// ==========   Agent Mode Config   ============== //

/**
 * Get current agent's mode.
 * Agent mode is the default — only an explicit `chatConfig.enableAgentMode === false`
 * collapses the agent to chat mode.
 */
const currentAgentMode = (s: AgentStoreState): AgentMode | undefined => {
  const config = currentAgentConfig(s);
  const chatConfig = config?.chatConfig;
  return chatConfig?.enableAgentMode === false ? undefined : 'auto';
};

/**
 * Check if current agent mode is enabled
 */
const isAgentModeEnabled = (s: AgentStoreState): boolean => currentAgentMode(s) !== undefined;

/**
 * Get current agent's runtime env config
 * Now reads from chatConfig.runtimeEnv
 */
const currentAgentRuntimeEnvConfig = (s: AgentStoreState): RuntimeEnvConfig | undefined =>
  currentAgentConfig(s)?.chatConfig?.runtimeEnv;

/**
 * Get the active agent's agent-level working directory.
 *
 * Precedence mirrors `getAgentWorkingDirectoryById` (the agent-owned slice only;
 * topic overrides are layered on by callers):
 *
 *   agent's per-device choice (`agencyConfig.workingDirByDevice[targetDeviceId]`)
 *     > legacy per-agent localStorage value > home path
 *
 * `currentDeviceId` is passed in (not read cross-store) so the target device is
 * resolved correctly for device-bound agents and hook callers stay reactive.
 */
const currentAgentWorkingDirectory =
  (currentDeviceId?: string) =>
  (s: AgentStoreState): string | undefined => {
    if (!isDesktop) return;

    const homePath = globalAgentContextManager.getContext().homePath;
    const activeAgentId = s.activeAgentId;
    if (!activeAgentId) return homePath;

    const agencyConfig = currentAgentConfig(s)?.agencyConfig;
    const targetDeviceId = resolveTargetDeviceId(agencyConfig, currentDeviceId);
    const agentChoice = targetDeviceId
      ? agencyConfig?.workingDirByDevice?.[targetDeviceId]
      : undefined;

    return agentChoice ?? s.localAgentWorkingDirectoryMap[activeAgentId] ?? homePath;
  };

const isCurrentAgentExternal = (s: AgentStoreState): boolean => !currentAgentData(s)?.virtual;

/**
 * Whether current agent is driven by an external heterogeneous runtime
 * (e.g. Claude Code). These agents skip LobeHub's message-channel / model
 * pickers because their toolchain is owned by the external runtime.
 */
const isCurrentAgentHeterogeneous = (s: AgentStoreState): boolean =>
  !!currentAgentConfig(s)?.agencyConfig?.heterogeneousProvider;

const canCurrentAgentPublishToCommunity = (s: AgentStoreState): boolean =>
  !!currentAgentData(s) && !isCurrentAgentHeterogeneous(s);

const currentAgentHeterogeneousProviderType = (s: AgentStoreState) =>
  currentAgentConfig(s)?.agencyConfig?.heterogeneousProvider?.type;

const currentAgentExecutionTarget = (s: AgentStoreState) =>
  currentAgentConfig(s)?.agencyConfig?.executionTarget;

const getAgentDocumentsById = (agentId: string) => (s: AgentStoreState) =>
  s.agentDocumentsMap[agentId];

export const agentSelectors = {
  canCurrentAgentPublishToCommunity,
  currentAgentExecutionTarget,
  currentAgentHeterogeneousProviderType,
  currentAgentAvatar,
  currentAgentBackgroundColor,
  currentAgentConfig,
  currentAgentConfigError,
  currentAgentDescription,
  currentAgentFiles,
  currentAgentKnowledgeBases,
  currentAgentRuntimeEnvConfig,
  currentAgentMeta,
  currentAgentMode,
  currentAgentModel,
  currentAgentModelProvider,
  currentAgentPlugins,
  currentAgentSystemRole,
  currentAgentTTS,
  currentAgentTTSVoice,
  currentAgentTags,
  currentAgentTitle,
  currentAgentWorkingDirectory,
  currentEnabledKnowledge,
  currentKnowledgeIds,
  displayableAgentPlugins,
  getAgentConfigById,
  getAgentDocumentsById,
  getAgentMetaById,
  getAgentSlugById,
  hasEnabledKnowledge,
  hasEnabledKnowledgeBases,
  hasKnowledge,
  hasSystemRole,
  inboxAgentConfig,
  inboxAgentModel,
  isAgentConfigError,
  isAgentConfigLoading,
  isAgentModeEnabled,
  isCurrentAgentExternal,
  isCurrentAgentHeterogeneous,
  openingMessage,
  openingQuestions,
};
