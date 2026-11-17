import {
  countContextTokens,
  type TokenSourceType,
  ToolNameResolver,
} from '@lobechat/context-engine';
import { pluginPrompts } from '@lobechat/prompts';
import type { UIChatMessage } from '@lobechat/types';
import { debounce } from 'es-toolkit/compat';
import { startTransition, useEffect, useMemo, useState } from 'react';

import { createAgentToolsEngine } from '@/helpers/toolEngineering';
import { useModelContextWindowTokens } from '@/hooks/useModelContextWindowTokens';
import { useModelSupportToolUse } from '@/hooks/useModelSupportToolUse';
import { useTokenCount } from '@/hooks/useTokenCount';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { useAiInfraStore } from '@/store/aiInfra';
import { aiModelSelectors, aiProviderSelectors } from '@/store/aiInfra/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useToolStore } from '@/store/tool';
import { pluginHelpers } from '@/store/tool/helpers';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useEffectiveModel } from '../../hooks/useEffectiveModel';
import { useTopicId } from '../../hooks/useTopicId';
import { useStoreApi } from '../../store';
import type { ContextWindow } from '../../store/initialState';
import { getToolContextRefreshKey, getToolExcludeDefaultToolIds } from './utils';

const toolNameResolver = new ToolNameResolver();

type ChatInputStoreApi = ReturnType<typeof useStoreApi>;
type SourceTokens = Record<TokenSourceType, number>;

const EMPTY_MESSAGES: UIChatMessage[] = [];

/**
 * `countContextTokens` replaces an assistant message's per-field estimate with
 * its recorded provider output count when one exists. Drop that count so the
 * whole breakdown stays on one estimator and the reply's tool calls and
 * reasoning keep their own sources.
 */
const withoutRecordedUsage = (message: UIChatMessage): UIChatMessage =>
  message.usage || message.metadata?.usage
    ? {
        ...message,
        metadata: message.metadata && { ...message.metadata, usage: undefined },
        usage: undefined,
      }
    : message;

const countContextWindowMessages = (messages: UIChatMessage[]): SourceTokens =>
  countContextTokens({
    messages: messages.map(withoutRecordedUsage),
    options: { driftMultiplier: 1 },
  }).bySource;

interface ComposerSource {
  /** Sources of `contextWindow.history`, used when no recorded request applies. */
  history: SourceTokens;
  input: string;
  request?: ContextWindow['request'];
  /** Sources of `contextWindow.request.messages`, the part the request does not cover. */
  sinceRequest: SourceTokens;
}

interface CountCacheSlot {
  messages?: UIChatMessage[];
  tokens: SourceTokens;
}

interface ComposerSourceCache {
  history: CountCacheSlot;
  sinceRequest: CountCacheSlot;
}

const createCountCacheSlot = (): CountCacheSlot => ({
  tokens: countContextWindowMessages(EMPTY_MESSAGES),
});

// The store notifies on every keystroke; only re-count when the messages change.
const countCached = (slot: CountCacheSlot, messages: UIChatMessage[]) => {
  if (slot.messages !== messages) {
    slot.messages = messages;
    slot.tokens = countContextWindowMessages(messages);
  }
  return slot.tokens;
};

const readComposerSource = (
  storeApi: ChatInputStoreApi,
  cache: ComposerSourceCache,
): ComposerSource => {
  const { contextWindow, markdownContent } = storeApi.getState();

  return {
    history: countCached(cache.history, contextWindow?.history ?? EMPTY_MESSAGES),
    input: markdownContent || '',
    request: contextWindow?.request,
    sinceRequest: countCached(
      cache.sinceRequest,
      contextWindow?.request?.messages ?? EMPTY_MESSAGES,
    ),
  };
};

// A render subscription to `markdownContent` would re-render the tag on every
// keystroke at urgent priority, and the conversation re-counts on every
// streamed chunk. Read the composer imperatively behind a debounce instead,
// and publish through a transition so token counting never competes with typing.
const useComposerSource = (): ComposerSource => {
  const storeApi = useStoreApi();
  const [cache] = useState<ComposerSourceCache>(() => ({
    history: createCountCacheSlot(),
    sinceRequest: createCountCacheSlot(),
  }));
  const [source, setSource] = useState<ComposerSource>(() => readComposerSource(storeApi, cache));

  useEffect(() => {
    const update = debounce(() => {
      const next = readComposerSource(storeApi, cache);
      startTransition(() => {
        setSource((prev) =>
          prev.input === next.input &&
          prev.history === next.history &&
          prev.sinceRequest === next.sinceRequest &&
          prev.request === next.request
            ? prev
            : next,
        );
      });
    }, 300);
    update();
    const unsubscribe = storeApi.subscribe(update);
    return () => {
      unsubscribe();
      update.cancel();
    };
  }, [cache, storeApi]);

  return source;
};

/**
 * Estimated tokens of the conversation's next request, by the parts of the
 * request body they come from. All counts use the `tokenx` estimator.
 */
export interface TokenBreakdown {
  /** Message text: user and assistant content, tool results, tool call ids and the draft. */
  chatsToken: number;
  /** Attachment text inlined as `<files_info>` blocks. */
  fileContextToken: number;
  /** Provider-reported input tokens of the latest recorded request, when known. */
  lastRequestInputTokens?: number;
  maxTokens: number;
  /** Reasoning replayed from earlier assistant turns. */
  reasoningToken: number;
  /** System messages: the system role plus injected tool prompts, memory, history summary… */
  systemToken: number;
  /** Assistant tool call payloads and their thought signatures. */
  toolCallsToken: number;
  /** The request's `tools` array. */
  toolsToken: number;
  totalToken: number;
}

export const useTokenBreakdown = (): TokenBreakdown => {
  const { history, input, request: recordedRequest, sinceRequest } = useComposerSource();
  // The summary of this composer's own conversation (see `useTopicId`), never
  // the global active topic's: an embedded composer would otherwise count the
  // outer chat's history against its context window.
  const topicId = useTopicId();
  // The topic itself is loaded by id in `useTopicModel` (via `useEffectiveModel`
  // below), so a sidebar-excluded topic's persisted summary arrives here too.
  const historySummary = useChatStore((s) =>
    topicId ? topicSelectors.getTopicById(topicId)(s)?.historySummary || '' : '',
  );

  const agentId = useAgentId();
  const { model, provider } = useEffectiveModel(agentId);
  // A request recorded for another model carried that model's tools and system
  // prompt; after a model switch, estimate the next request from scratch.
  const request =
    recordedRequest &&
    (!recordedRequest.model || recordedRequest.model === model) &&
    (!recordedRequest.provider || recordedRequest.provider === provider)
      ? recordedRequest
      : undefined;
  const hasRequest = !!request;
  // The recorded messages plus what came after describe the next request only
  // while nothing drops out of history; otherwise count the history window.
  const recordedMessages = request?.messages ? request.accounting.bySource : undefined;
  const messages = recordedMessages ? sinceRequest : history;
  const [
    activeAgentId,
    systemRole,
    enableAgentMode,
    searchMode,
    useModelBuiltinSearch,
    skillActivateMode,
    agentMemoryEnabled,
    runtimeMode,
    hasEnabledKnowledgeBases,
  ] = useAgentStore((s) => {
    const chatConfig = chatConfigByIdSelectors.getChatConfigById(agentId)(s);

    return [
      s.activeAgentId,
      agentByIdSelectors.getAgentSystemRoleById(agentId)(s),
      chatConfig.enableAgentMode,
      chatConfig.searchMode,
      chatConfig.useModelBuiltinSearch,
      chatConfigByIdSelectors.getSkillActivateModeById(agentId)(s),
      chatConfig.memory?.enabled,
      chatConfigByIdSelectors.getRuntimeModeById(agentId)(s),
      agentByIdSelectors
        .getAgentKnowledgeBasesById(agentId)(s)
        .some((item) => item.enabled),
    ];
  });
  const globalMemoryEnabled = useUserStore(settingsSelectors.memoryEnabled);
  const effectiveMemoryEnabled = agentMemoryEnabled ?? globalMemoryEnabled;
  const [isProviderHasBuiltinSearch, isModelHasBuiltinSearch, isModelBuiltinSearchInternal] =
    useAiInfraStore((s) => [
      aiProviderSelectors.isProviderHasBuiltinSearch(provider)(s),
      aiModelSelectors.isModelHasBuiltinSearch(model, provider)(s),
      aiModelSelectors.isModelBuiltinSearchInternal(model, provider)(s),
    ]);
  const toolContextRefreshKey = getToolContextRefreshKey({
    agentId: activeAgentId || agentId,
    enableAgentMode,
    hasEnabledKnowledgeBases,
    isModelBuiltinSearchInternal,
    isModelHasBuiltinSearch,
    isProviderHasBuiltinSearch,
    memoryEnabled: effectiveMemoryEnabled,
    runtimeMode,
    searchMode,
    skillActivateMode,
    useModelBuiltinSearch,
  });

  const maxTokens = useModelContextWindowTokens(model, provider);

  const canUseTool = useModelSupportToolUse(model, provider);
  const pluginIds = useAgentStore((s) => agentByIdSelectors.getAgentPluginsById(agentId)(s));
  const installedPlugins = useToolStore((s) => s.installedPlugins);

  // The fallback for a conversation with no recorded request yet. Once the
  // runtime has recorded one, its system and tools counts are authoritative.
  const { toolsSchema, toolsSystemRole } = useMemo(() => {
    if (hasRequest) return { toolsSchema: '', toolsSystemRole: '' };

    const toolsEngine = createAgentToolsEngine({ model, provider });

    const { tools, enabledManifests } = toolsEngine.generateToolsDetailed({
      excludeDefaultToolIds: getToolExcludeDefaultToolIds(skillActivateMode),
      model,
      provider,
      toolIds: pluginIds,
    });

    return {
      toolsSchema: tools?.map((i) => JSON.stringify(i)).join('') || '',
      // Tool prompts are injected into the system message, not the tools array.
      toolsSystemRole:
        enabledManifests.length > 0
          ? pluginPrompts({
              tools: enabledManifests.map((manifest) => ({
                apis: manifest.api.map((api) => ({
                  desc: api.description,
                  name: toolNameResolver.generate(manifest.identifier, api.name, manifest.type),
                })),
                identifier: manifest.identifier,
                name: pluginHelpers.getPluginTitle(manifest.meta) || manifest.identifier,
                systemRole: manifest.systemRole,
              })),
            })
          : '',
    };
    // installedPlugins + toolContextRefreshKey track the implicit
    // createAgentToolsEngine inputs read via getState() (tool manifests plus
    // agent/user/aiInfra config), so the engine only re-runs when they change
    // instead of on every render.
  }, [
    hasRequest,
    installedPlugins,
    model,
    pluginIds,
    provider,
    skillActivateMode,
    toolContextRefreshKey,
  ]);

  const toolsSchemaToken = useTokenCount(canUseTool ? toolsSchema : '');
  const toolsSystemRoleToken = useTokenCount(canUseTool ? toolsSystemRole : '');
  const systemRoleToken = useTokenCount(hasRequest ? '' : systemRole);
  const historySummaryToken = useTokenCount(hasRequest ? '' : historySummary);
  const inputTokenCount = useTokenCount(input);

  const recorded = request?.accounting;
  const sum = (key: TokenSourceType) => (recordedMessages?.[key] ?? 0) + messages[key];

  const systemToken = recorded
    ? recorded.system
    : systemRoleToken + historySummaryToken + toolsSystemRoleToken;
  const toolsToken = recorded ? recorded.bySource.toolDefinition : toolsSchemaToken;
  const chatsToken = sum('content') + sum('toolCallId') + inputTokenCount;
  const fileContextToken = sum('fileContext');
  const toolCallsToken = sum('toolCalls') + sum('thoughtSignature');
  const reasoningToken = sum('reasoning');

  const totalToken =
    systemToken + toolsToken + chatsToken + fileContextToken + toolCallsToken + reasoningToken;

  const lastRequestInputTokens = request?.inputTokens;

  // A stable object, so the popover content only re-renders when a count changes.
  return useMemo(
    () => ({
      chatsToken,
      fileContextToken,
      lastRequestInputTokens,
      maxTokens,
      reasoningToken,
      systemToken,
      toolCallsToken,
      toolsToken,
      totalToken,
    }),
    [
      chatsToken,
      fileContextToken,
      lastRequestInputTokens,
      maxTokens,
      reasoningToken,
      systemToken,
      toolCallsToken,
      toolsToken,
      totalToken,
    ],
  );
};
