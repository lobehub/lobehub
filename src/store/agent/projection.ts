'use client';

import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { DEFAULT_PROVIDER } from '@lobechat/business-const';
import {
  DEFAULT_AGENT_CHAT_CONFIG,
  DEFAULT_AGENT_CONFIG,
  DEFAULT_AGENT_SEARCH_FC_MODEL,
  DEFAULT_AVATAR,
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_INBOX_AVATAR,
  DEFAULT_MODEL,
  DEFAUTT_AGENT_TTS_CONFIG,
  isDesktop,
} from '@lobechat/const';
import type { AgentBuilderContext } from '@lobechat/context-engine';
import {
  agentDisplayName,
  type AgentMode,
  getActivePluginIds,
  getDisabledPluginIds,
  getWorkingDirEffectivePath,
  type KnowledgeItem,
  KnowledgeType,
  type LobeAgentAgencyConfig,
  type LobeAgentChatConfig,
  type LobeAgentConfig,
  type LobeAgentTTSConfig,
  type MetaData,
  type RuntimeEnvConfig,
} from '@lobechat/types';
import isEqual from 'fast-deep-equal';

import { DEFAULT_OPENING_QUESTIONS } from '@/features/AgentSetting/store/selectors';
import { resolveTargetDeviceId } from '@/helpers/agentWorkingDirectory';
import { resolveToolMode } from '@/helpers/executionTarget';
import { globalAgentContextManager } from '@/helpers/GlobalAgentContextManager';
import { filterToolIds } from '@/helpers/toolFilters';
import {
  type AgentProjectionView,
  getAgentProjection,
  getAgentProjectionById,
  selectAgentProjectionRecord,
  useAgentProjection,
  useAgentProjectionRecord,
} from '@/projection';

import { builtinAgentSelectors } from './selectors/builtinAgentSelectors';
import { getAgentStoreState, useAgentStore } from './store';

const BUILTIN_AGENT_SLUG_SET = new Set<string>(Object.values(BUILTIN_AGENT_SLUGS));

export const agentProjectionSelectors = {
  agencyConfig: (agent: AgentProjectionView | undefined): LobeAgentAgencyConfig | undefined =>
    agent?.agencyConfig,
  avatar: (agent: AgentProjectionView | undefined): string | undefined =>
    typeof agent?.avatar === 'string' ? agent.avatar : undefined,
  chatConfig: (agent: AgentProjectionView | undefined): LobeAgentChatConfig =>
    agent?.chatConfig ?? {},
  config: (agent: AgentProjectionView | undefined): LobeAgentConfig | undefined =>
    agent as LobeAgentConfig | undefined,
  createdAt: (agent: AgentProjectionView | undefined) => agent?.createdAt,
  disabledPlugins: (agent: AgentProjectionView | undefined): string[] =>
    getDisabledPluginIds(agent?.plugins),
  displayName: (agent: AgentProjectionView | undefined): string | undefined =>
    agentDisplayName(agent),
  displayablePlugins: (agent: AgentProjectionView | undefined): string[] =>
    filterToolIds(getActivePluginIds(agent?.plugins)),
  enableHistoryCount: (agent: AgentProjectionView | undefined) =>
    agent?.chatConfig?.enableHistoryCount,
  enableMode: (agent: AgentProjectionView | undefined): boolean =>
    agent?.chatConfig?.enableAgentMode !== false,
  files: (agent: AgentProjectionView | undefined) => agent?.files ?? [],
  heterogeneous: (agent: AgentProjectionView | undefined): boolean =>
    Boolean(agent?.agencyConfig?.heterogeneousProvider),
  heterogeneousProviderType: (agent: AgentProjectionView | undefined) =>
    agent?.agencyConfig?.heterogeneousProvider?.type,
  historyCount: (agent: AgentProjectionView | undefined): number =>
    agent?.chatConfig?.historyCount ?? (DEFAULT_AGENT_CHAT_CONFIG.historyCount as number),
  hasEnabledKnowledge: (agent: AgentProjectionView | undefined): boolean =>
    [...(agent?.files ?? []), ...(agent?.knowledgeBases ?? [])].some((item) => item.enabled),
  hasEnabledKnowledgeBases: (agent: AgentProjectionView | undefined): boolean =>
    (agent?.knowledgeBases ?? []).some((item) => item.enabled),
  isExternal: (agent: AgentProjectionView | undefined): boolean => !agent?.virtual,
  knowledgeBases: (agent: AgentProjectionView | undefined) => agent?.knowledgeBases ?? [],
  memoryConfig: (agent: AgentProjectionView | undefined) => agent?.chatConfig?.memory,
  memoryEffort: (agent: AgentProjectionView | undefined) =>
    agent?.chatConfig?.memory?.effort ?? 'medium',
  memoryEnabled: (agent: AgentProjectionView | undefined): boolean =>
    agent?.chatConfig?.memory?.enabled ?? false,
  model: (agent: AgentProjectionView | undefined): string => agent?.model || DEFAULT_MODEL,
  mode: (agent: AgentProjectionView | undefined): AgentMode | undefined =>
    agent?.chatConfig?.enableAgentMode === false ? undefined : 'auto',
  openingMessage: (agent: AgentProjectionView | undefined): string => agent?.openingMessage || '',
  openingQuestions: (agent: AgentProjectionView | undefined) =>
    agent?.openingQuestions || DEFAULT_OPENING_QUESTIONS,
  plugins: (agent: AgentProjectionView | undefined): string[] => getActivePluginIds(agent?.plugins),
  provider: (agent: AgentProjectionView | undefined): string => agent?.provider || DEFAULT_PROVIDER,
  runtimeEnvConfig: (agent: AgentProjectionView | undefined): RuntimeEnvConfig | undefined =>
    agent?.chatConfig?.runtimeEnv,
  searchFCModel: (agent: AgentProjectionView | undefined) =>
    agent?.chatConfig?.searchFCModel || DEFAULT_AGENT_SEARCH_FC_MODEL,
  searchMode: (agent: AgentProjectionView | undefined) => agent?.chatConfig?.searchMode || 'auto',
  searchEnabled: (agent: AgentProjectionView | undefined): boolean =>
    (agent?.chatConfig?.searchMode || 'auto') !== 'off',
  skillActivateMode: (agent: AgentProjectionView | undefined): 'auto' | 'manual' =>
    agent?.chatConfig?.skillActivateMode ?? 'auto',
  slug: (agent: AgentProjectionView | undefined) => agent?.slug,
  systemRole: (agent: AgentProjectionView | undefined) => agent?.systemRole,
  title: (agent: AgentProjectionView | undefined) => agent?.title,
  toolMode: (agent: AgentProjectionView | undefined): 'agent' | 'chat' | 'custom' =>
    resolveToolMode(agent?.chatConfig ?? {}),
  tts: (agent: AgentProjectionView | undefined): LobeAgentTTSConfig =>
    agent?.tts || DEFAUTT_AGENT_TTS_CONFIG,
  ttsVoice: (agent: AgentProjectionView | undefined): string =>
    (agent?.tts || DEFAUTT_AGENT_TTS_CONFIG).voice?.openai || 'alloy',
  visibility: (agent: AgentProjectionView | undefined) => agent?.visibility,
  useModelBuiltinSearch: (agent: AgentProjectionView | undefined) =>
    agent?.chatConfig?.useModelBuiltinSearch,
  userId: (agent: AgentProjectionView | undefined) => agent?.userId,
  workspaceScoped: (agent: AgentProjectionView | undefined): boolean => Boolean(agent?.workspaceId),
};

export const getAgentMeta = (agentId: string | undefined): MetaData => {
  const agent = getAgentProjectionById(agentId);
  const inboxAgentId = builtinAgentSelectors.inboxAgentId(getAgentStoreState());
  const defaultAvatar = agentId && inboxAgentId === agentId ? DEFAULT_INBOX_AVATAR : DEFAULT_AVATAR;

  return {
    avatar: agentProjectionSelectors.avatar(agent) || defaultAvatar,
    backgroundColor: agent?.backgroundColor || DEFAULT_BACKGROUND_COLOR,
    description: agent?.description || undefined,
    marketIdentifier: agent?.marketIdentifier || undefined,
    name: agent?.name || undefined,
    tags: agent?.tags,
    title: agent?.title || undefined,
  };
};

export const useAgentMeta = (agentId: string | undefined): MetaData => {
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  return useAgentProjection(
    agentId,
    (agent) => {
      const defaultAvatar =
        agentId && inboxAgentId === agentId ? DEFAULT_INBOX_AVATAR : DEFAULT_AVATAR;
      return {
        avatar: agentProjectionSelectors.avatar(agent) || defaultAvatar,
        backgroundColor: agent?.backgroundColor || DEFAULT_BACKGROUND_COLOR,
        description: agent?.description || undefined,
        marketIdentifier: agent?.marketIdentifier || undefined,
        name: agent?.name || undefined,
        tags: agent?.tags,
        title: agent?.title || undefined,
      };
    },
    isEqual,
  );
};

export const useAgentConfig = (agentId: string | undefined): LobeAgentConfig | undefined =>
  useAgentProjection(agentId, agentProjectionSelectors.config, isEqual);

export const useAgentValue = <Selected>(
  agentId: string | undefined,
  selector: (agent: AgentProjectionView | undefined) => Selected,
  equalityFn?: (left: Selected, right: Selected) => boolean,
): Selected => useAgentProjection(agentId, selector, equalityFn);

export const useCurrentAgentValue = <Selected>(
  selector: (agent: AgentProjectionView | undefined) => Selected,
  equalityFn?: (left: Selected, right: Selected) => boolean,
): Selected => {
  const agentId = useAgentStore((state) => state.activeAgentId);
  return useAgentProjection(agentId, selector, equalityFn);
};

export const useAgentData = (agentId: string | undefined): AgentProjectionView | undefined =>
  useAgentProjection(agentId, (agent) => agent, isEqual);

export const useIsBuiltinAgent = (agentId: string | undefined): boolean => {
  const rowClassification = useAgentValue(agentId, (agent) => {
    if (!agent?.slug || agent.virtual === undefined) return undefined;
    return agent.virtual && BUILTIN_AGENT_SLUG_SET.has(agent.slug);
  });
  const initializedBuiltin = useAgentStore((state) =>
    agentId ? Object.values(state.builtinAgentIdMap).includes(agentId) : false,
  );

  return rowClassification ?? initializedBuiltin;
};

export const useCurrentAgentData = (): AgentProjectionView | undefined => {
  const agentId = useAgentStore((state) => state.activeAgentId);
  return useAgentData(agentId);
};

export const useCurrentAgentConfig = (): LobeAgentConfig | undefined => {
  const agentId = useAgentStore((state) => state.activeAgentId);
  return useAgentConfig(agentId);
};

export const useCurrentAgentMeta = (): MetaData => {
  const agentId = useAgentStore((state) => state.activeAgentId);
  return useAgentMeta(agentId);
};

export const useAgentConfigStatus = (agentId: string | undefined) => {
  const record = useAgentProjectionRecord(agentId);
  const error = useAgentStore((state) =>
    agentId ? state.agentConfigErrorMap[agentId] : undefined,
  );
  const data = useAgentConfig(agentId);
  const isNotFound = record?.tombstoneAt !== undefined;

  return {
    data,
    error,
    isLoading: !agentId || (!data && !isNotFound),
    isNotFound,
  };
};

export const getAgentConfigStatus = (agentId: string | undefined) => {
  const scope = getAgentProjection((projectionScope) => projectionScope);
  const record = selectAgentProjectionRecord(scope, agentId);
  const data = getAgentProjectionById(agentId) as LobeAgentConfig | undefined;
  const isNotFound = record?.tombstoneAt !== undefined;
  return {
    data,
    error: agentId ? getAgentStoreState().agentConfigErrorMap[agentId] : undefined,
    isLoading: !agentId || (!data && !isNotFound),
    isNotFound,
  };
};

export const useCurrentAgentConfigStatus = () => {
  const agentId = useAgentStore((state) => state.activeAgentId);
  return useAgentConfigStatus(agentId);
};

export const getAgentBuilderContext = (agentId: string): AgentBuilderContext => {
  const config = getAgentProjectionById(agentId);
  return {
    config: {
      chatConfig: config?.chatConfig,
      model: config?.model,
      openingMessage: config?.openingMessage,
      openingQuestions: config?.openingQuestions,
      params: config?.params,
      plugins: getActivePluginIds(config?.plugins),
      provider: config?.provider,
      systemRole: config?.systemRole,
    },
    meta: getAgentMeta(agentId),
  };
};

export const getAgentEnabledKnowledge = (agentId: string): KnowledgeItem[] => {
  const agent = getAgentProjectionById(agentId);
  return [
    ...(agent?.files ?? [])
      .filter((item) => item.enabled)
      .map((item) => ({
        fileType: item.type,
        id: item.id,
        name: item.name,
        type: KnowledgeType.File,
      })),
    ...(agent?.knowledgeBases ?? [])
      .filter((item) => item.enabled)
      .map((item) => ({ id: item.id, name: item.name, type: KnowledgeType.KnowledgeBase })),
  ];
};

export const getAgentKnowledgeIds = (agentId: string) => {
  const agent = getAgentProjectionById(agentId);
  return {
    fileIds: (agent?.files ?? []).filter((item) => item.enabled).map((item) => item.id),
    knowledgeBaseIds: (agent?.knowledgeBases ?? [])
      .filter((item) => item.enabled)
      .map((item) => item.id),
  };
};

export const getDisplayableAgentPlugins = (agentId: string): string[] =>
  filterToolIds(agentProjectionSelectors.plugins(getAgentProjectionById(agentId)));

export const getAgentWorkingDirectory = (
  agentId: string | undefined,
  currentDeviceId?: string,
): string | undefined => {
  if (!isDesktop) return;

  const context = globalAgentContextManager.getContext();
  if (!agentId) return context.homePath;
  const agencyConfig = getAgentProjectionById(agentId)?.agencyConfig;
  const targetDeviceId = resolveTargetDeviceId(agencyConfig, currentDeviceId);
  const agentChoice = targetDeviceId
    ? getWorkingDirEffectivePath(agencyConfig?.workingDirByDevice?.[targetDeviceId])
    : undefined;

  return (
    agentChoice ??
    getAgentStoreState().localAgentWorkingDirectoryMap[agentId] ??
    context.desktopPath ??
    context.homePath
  );
};

export const useAgentWorkingDirectory = (
  agentId: string | undefined,
  currentDeviceId?: string,
): string | undefined => {
  const localDirectory = useAgentStore((state) =>
    agentId ? state.localAgentWorkingDirectoryMap[agentId] : undefined,
  );
  const agencyConfig = useAgentProjection(agentId, agentProjectionSelectors.agencyConfig, isEqual);
  if (!isDesktop) return;

  const context = globalAgentContextManager.getContext();
  if (!agentId) return context.homePath;
  const targetDeviceId = resolveTargetDeviceId(agencyConfig, currentDeviceId);
  const agentChoice = targetDeviceId
    ? getWorkingDirEffectivePath(agencyConfig?.workingDirByDevice?.[targetDeviceId])
    : undefined;

  return agentChoice ?? localDirectory ?? context.desktopPath ?? context.homePath;
};

export const useCurrentAgentWorkingDirectory = (currentDeviceId?: string): string | undefined => {
  const agentId = useAgentStore((state) => state.activeAgentId);
  return useAgentWorkingDirectory(agentId, currentDeviceId);
};

export const getInboxAgentConfig = (): LobeAgentConfig => {
  const id = builtinAgentSelectors.inboxAgentId(getAgentStoreState());
  return (getAgentProjectionById(id) as LobeAgentConfig | undefined) ?? DEFAULT_AGENT_CONFIG;
};
