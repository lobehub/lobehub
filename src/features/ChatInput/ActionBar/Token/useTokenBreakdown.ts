import { countContextTokens, ToolNameResolver } from '@lobechat/context-engine';
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
import { useStoreApi } from '../../store';
import {
  bucketMessageTokensByRole,
  getToolContextRefreshKey,
  getToolExcludeDefaultToolIds,
} from './utils';

const toolNameResolver = new ToolNameResolver();

type ChatInputStoreApi = ReturnType<typeof useStoreApi>;

interface ComposerSource {
  input: string;
  messages: UIChatMessage[];
}

const EMPTY_MESSAGES: UIChatMessage[] = [];

const readComposerSource = (storeApi: ChatInputStoreApi): ComposerSource => {
  const state = storeApi.getState();
  return {
    input: state.markdownContent || '',
    messages: state.contextWindowMessages || EMPTY_MESSAGES,
  };
};

// A render subscription to `markdownContent` would re-render the tag on every
// keystroke at urgent priority. Read the composer imperatively behind a
// debounce instead, and publish through a transition so token counting never
// competes with typing.
const useComposerSource = (): ComposerSource => {
  const storeApi = useStoreApi();
  const [source, setSource] = useState<ComposerSource>(() => readComposerSource(storeApi));

  useEffect(() => {
    const update = debounce(() => {
      const next = readComposerSource(storeApi);
      startTransition(() => {
        setSource((prev) =>
          prev.input === next.input && prev.messages === next.messages ? prev : next,
        );
      });
    }, 300);
    update();
    const unsubscribe = storeApi.subscribe(update);
    return () => {
      unsubscribe();
      update.cancel();
    };
  }, [storeApi]);

  return source;
};

export interface TokenBreakdown {
  /** Assistant text + reasoning inside the context window */
  assistantMessagesToken: number;
  /** Sum of the three conversation buckets (user + assistant + tool) */
  chatsToken: number;
  historySummaryToken: number;
  maxTokens: number;
  systemRoleToken: number;
  /** Tool call payloads + tool results + tool_call_id linkage */
  toolMessagesToken: number;
  toolsToken: number;
  totalToken: number;
  /** User message text + the current composer draft */
  userMessagesToken: number;
}

export const useTokenBreakdown = (): TokenBreakdown => {
  const { input, messages } = useComposerSource();
  const historySummary = useChatStore(
    (s) => topicSelectors.currentActiveTopicSummary(s)?.content || '',
  );

  const agentId = useAgentId();
  const { model, provider } = useEffectiveModel(agentId);
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

  const toolsString = useMemo(() => {
    const toolsEngine = createAgentToolsEngine({ model, provider });

    const { tools, enabledManifests } = toolsEngine.generateToolsDetailed({
      excludeDefaultToolIds: getToolExcludeDefaultToolIds(skillActivateMode),
      model,
      provider,
      toolIds: pluginIds,
    });
    const schemaNumber = tools?.map((i) => JSON.stringify(i)).join('') || '';

    const toolsSystemRole =
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
        : '';

    return toolsSystemRole + schemaNumber;
    // installedPlugins + toolContextRefreshKey track the implicit
    // createAgentToolsEngine inputs read via getState() (tool manifests plus
    // agent/user/aiInfra config), so the engine only re-runs when they change
    // instead of on every render.
  }, [installedPlugins, model, pluginIds, provider, skillActivateMode, toolContextRefreshKey]);

  const toolsToken = useTokenCount(canUseTool ? toolsString : '');

  const inputTokenCount = useTokenCount(input);

  // Full context accounting: unlike joining message.content strings, this
  // also counts tool call arguments, tool results, and reasoning — which
  // dominate agent conversations.
  const messageBuckets = useMemo(
    () => bucketMessageTokensByRole(countContextTokens({ messages }).messages),
    [messages],
  );

  const userMessagesToken = messageBuckets.user + inputTokenCount;
  const assistantMessagesToken = messageBuckets.assistant;
  const toolMessagesToken = messageBuckets.tool;
  const chatsToken = userMessagesToken + assistantMessagesToken + toolMessagesToken;

  const systemRoleToken = useTokenCount(systemRole);
  const historySummaryToken = useTokenCount(historySummary);

  const totalToken = systemRoleToken + historySummaryToken + toolsToken + chatsToken;

  return {
    assistantMessagesToken,
    chatsToken,
    historySummaryToken,
    maxTokens,
    systemRoleToken,
    toolMessagesToken,
    toolsToken,
    totalToken,
    userMessagesToken,
  };
};
