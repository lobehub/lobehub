import { manualModeExcludeToolIds } from '@lobechat/builtin-tools';
import type { MessageTokenBreakdown } from '@lobechat/context-engine';
import type { LobeAgentChatConfig, RuntimeEnvMode } from '@lobechat/types';

export interface ChatMessagesTokenBuckets {
  assistant: number;
  tool: number;
  user: number;
}

/**
 * Attribute per-message token accounting to the three conversation buckets
 * shown in the context-detail panel.
 *
 * - `user` — text the user typed
 * - `assistant` — assistant text + reasoning (the recorded-usage fast-path
 *   also lands here, which folds that turn's tool-call arguments in)
 * - `tool` — tool call payloads, tool results, and tool_call_id linkage,
 *   wherever they live (inline on assistant messages or standalone `tool`
 *   role messages)
 */
export const bucketMessageTokensByRole = (
  messages: MessageTokenBreakdown[],
): ChatMessagesTokenBuckets => {
  const buckets: ChatMessagesTokenBuckets = { assistant: 0, tool: 0, user: 0 };

  for (const message of messages) {
    const {
      content = 0,
      reasoning = 0,
      thoughtSignature = 0,
      toolCallId = 0,
      toolCalls = 0,
      toolResult = 0,
    } = message.bySource;

    buckets.tool += toolCalls + toolCallId + thoughtSignature + toolResult;

    const ownText = content + reasoning;
    if (message.role === 'user') buckets.user += ownText;
    else if (message.role === 'tool') buckets.tool += ownText;
    else buckets.assistant += ownText;
  }

  return buckets;
};

interface ToolContextRefreshKeyOptions {
  agentId?: string;
  enableAgentMode?: boolean;
  hasEnabledKnowledgeBases?: boolean;
  isModelBuiltinSearchInternal?: boolean;
  isModelHasBuiltinSearch?: boolean;
  isProviderHasBuiltinSearch?: boolean;
  memoryEnabled?: boolean;
  runtimeMode?: RuntimeEnvMode;
  searchMode?: LobeAgentChatConfig['searchMode'];
  skillActivateMode?: LobeAgentChatConfig['skillActivateMode'];
  useModelBuiltinSearch?: boolean;
}

export const getToolExcludeDefaultToolIds = (
  skillActivateMode?: LobeAgentChatConfig['skillActivateMode'],
) => (skillActivateMode === 'manual' ? manualModeExcludeToolIds : undefined);

export const getToolContextRefreshKey = ({
  agentId,
  enableAgentMode,
  hasEnabledKnowledgeBases,
  isModelBuiltinSearchInternal,
  isModelHasBuiltinSearch,
  isProviderHasBuiltinSearch,
  memoryEnabled,
  runtimeMode,
  searchMode,
  skillActivateMode,
  useModelBuiltinSearch,
}: ToolContextRefreshKeyOptions) =>
  [
    agentId || '',
    enableAgentMode === false ? 'chat' : 'agent',
    searchMode || 'auto',
    useModelBuiltinSearch ? 'model-search' : 'app-search',
    skillActivateMode || 'auto',
    memoryEnabled ? 'memory-on' : 'memory-off',
    hasEnabledKnowledgeBases ? 'knowledge-on' : 'knowledge-off',
    runtimeMode || 'none',
    isProviderHasBuiltinSearch ? 'provider-search-on' : 'provider-search-off',
    isModelHasBuiltinSearch ? 'model-search-on' : 'model-search-off',
    isModelBuiltinSearchInternal ? 'internal-search-on' : 'internal-search-off',
  ].join('|');
