import {
  DEFAULT_AGENT_CONFIG,
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
  DEFAUTT_AGENT_TTS_CONFIG,
  INBOX_SESSION_ID,
} from '@lobechat/const';
import { KnowledgeItem, KnowledgeType, LobeAgentConfig, LobeAgentTTSConfig } from '@lobechat/types';
import { VoiceList } from '@lobehub/tts';

import { DEFAULT_OPENING_QUESTIONS } from '@/features/AgentSetting/store/selectors';
import { filterToolIds } from '@/helpers/toolFilters';
import { AgentStoreState } from '@/store/agent/initialState';
import { merge } from '@/utils/merge';

const isInboxSession = (s: AgentStoreState) => s.activeId === INBOX_SESSION_ID;

// ==========   Config   ============== //

const inboxAgentConfig = (s: AgentStoreState) =>
  merge(DEFAULT_AGENT_CONFIG, s.agentMap[INBOX_SESSION_ID]);
const inboxAgentModel = (s: AgentStoreState) => inboxAgentConfig(s).model;

const getAgentConfigById =
  (id: string) =>
  (s: AgentStoreState): LobeAgentConfig =>
    merge(s.defaultAgentConfig, s.agentMap[id]);

const getAgentConfigByAgentId =
  (agentId: string) =>
  (s: AgentStoreState): LobeAgentConfig => {
    // Find the session that contains this agent
    const sessionId = Object.keys(s.agentMap).find((sessionKey) => {
      const agentConfig = s.agentMap[sessionKey];
      return agentConfig?.id === agentId;
    });

    if (sessionId) {
      return merge(s.defaultAgentConfig, s.agentMap[sessionId]);
    }

    // Fallback to default config if agent not found
    return s.defaultAgentConfig;
  };

export const currentAgentConfig = (s: AgentStoreState): LobeAgentConfig =>
  getAgentConfigById(s.activeId)(s);

const currentAgentSystemRole = (s: AgentStoreState) => {
  return currentAgentConfig(s).systemRole;
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

  return !!config.systemRole;
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

const isAgentConfigLoading = (s: AgentStoreState) => !s.agentConfigInitMap[s.activeId];

const openingQuestions = (s: AgentStoreState) =>
  currentAgentConfig(s).openingQuestions || DEFAULT_OPENING_QUESTIONS;
const openingMessage = (s: AgentStoreState) => currentAgentConfig(s).openingMessage || '';

export const agentSelectors = {
  currentAgentConfig,
  currentAgentFiles,
  currentAgentKnowledgeBases,
  currentAgentModel,
  currentAgentModelProvider,
  currentAgentPlugins,
  currentAgentSystemRole,
  currentAgentTTS,
  currentAgentTTSVoice,
  currentEnabledKnowledge,
  currentKnowledgeIds,
  displayableAgentPlugins,
  getAgentConfigByAgentId,
  getAgentConfigById,
  hasEnabledKnowledge,
  hasKnowledge,
  hasSystemRole,
  inboxAgentConfig,
  inboxAgentModel,
  isAgentConfigLoading,
  isInboxSession,
  openingMessage,
  openingQuestions,
};
