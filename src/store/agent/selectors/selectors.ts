import { DEFAULT_PROVIDER } from '@lobechat/business-const';
import {
  DEFAULT_AGENT_CONFIG,
  DEFAULT_AVATAR,
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_MODEL,
  DEFAUTT_AGENT_TTS_CONFIG,
} from '@lobechat/const';
import {
  type AgentMode,
  type KnowledgeItem,
  type LobeAgentConfig,
  type LobeAgentTTSConfig,
  type LocalSystemConfig,
  type MetaData,
} from '@lobechat/types';
import { KnowledgeType } from '@lobechat/types';
import { VoiceList } from '@lobehub/tts';

import { DEFAULT_OPENING_QUESTIONS } from '@/features/AgentSetting/store/selectors';
import { filterToolIds } from '@/helpers/toolFilters';

import { type AgentStoreState } from '../initialState';
import { builtinAgentSelectors } from './builtinAgentSelectors';

// ==========   Meta   ============== //

const currentAgentData = (s: AgentStoreState) =>
  s.activeAgentId ? s.agentMap[s.activeAgentId] : undefined;

const currentAgentTitle = (s: AgentStoreState) => currentAgentData(s)?.title;

const currentAgentAvatar = (s: AgentStoreState) => currentAgentData(s)?.avatar || DEFAULT_AVATAR;

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
    avatar: data?.avatar || DEFAULT_AVATAR,
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
      avatar: data.avatar || DEFAULT_AVATAR,
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
 * Get agent's slug by ID (used to identify builtin agents)
 */
const getAgentSlugById = (agentId: string) => (s: AgentStoreState) => s.agentMap[agentId]?.slug;

const openingQuestions = (s: AgentStoreState) =>
  currentAgentConfig(s)?.openingQuestions || DEFAULT_OPENING_QUESTIONS;
const openingMessage = (s: AgentStoreState) => currentAgentConfig(s)?.openingMessage || '';

// ==========   Agent Mode Config   ============== //

/**
 * Get current agent's mode
 * Now reads from chatConfig.agentMode and chatConfig.enableAgentMode
 */
const currentAgentMode = (s: AgentStoreState): AgentMode | undefined => {
  const config = currentAgentConfig(s);

  // Fallback: convert enableAgentMode to mode
  if (config?.enableAgentMode) {
    return 'auto';
  }

  return undefined;
};

/**
 * Check if current agent mode is enabled
 */
const isAgentModeEnabled = (s: AgentStoreState): boolean => currentAgentMode(s) !== undefined;

/**
 * Get current agent's local system config
 * Now reads from chatConfig.localSystem
 */
const currentAgentLocalSystemConfig = (s: AgentStoreState): LocalSystemConfig | undefined =>
  currentAgentConfig(s)?.chatConfig?.localSystem;

/**
 * Get current agent's working directory
 */
const currentAgentWorkingDirectory = (s: AgentStoreState): string | undefined =>
  currentAgentLocalSystemConfig(s)?.workingDirectory;

const isCurrentAgentExternal = (s: AgentStoreState): boolean => !currentAgentData(s)?.virtual;

export const agentSelectors = {
  currentAgentAvatar,
  currentAgentBackgroundColor,
  currentAgentConfig,
  currentAgentDescription,
  currentAgentFiles,
  currentAgentKnowledgeBases,
  currentAgentLocalSystemConfig,
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
  getAgentMetaById,
  getAgentSlugById,
  hasEnabledKnowledge,
  hasEnabledKnowledgeBases,
  hasKnowledge,
  hasSystemRole,
  inboxAgentConfig,
  inboxAgentModel,
  isAgentConfigLoading,
  isAgentModeEnabled,
  isCurrentAgentExternal,
  openingMessage,
  openingQuestions,
};
