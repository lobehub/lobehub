import { PLUGIN_SCHEMA_SEPARATOR } from '@lobechat/const/plugin';
import type { ChatToolPayload } from '@lobechat/types';
import { isPlainRecord } from '@lobechat/utils/object';

import type { TrpcClient } from '../../api/client';
import { cliVersion } from '../../pkg';

export type TopicTranscript = Awaited<
  ReturnType<TrpcClient['topic']['getTopicTranscript']['query']>
>;

interface AtifMetrics {
  cached_tokens?: number;
  completion_tokens?: number;
  cost_usd?: number;
  prompt_tokens?: number;
}

interface AtifStep {
  extra: { error?: unknown; message_id: string; parent_id: string | null; provider?: string };
  is_copied_context?: boolean;
  message: string;
  metrics?: AtifMetrics;
  model_name?: string;
  observation?: {
    results: {
      content: string | null;
      extra: { error?: unknown; message_id: string };
      source_call_id: string;
    }[];
  };
  reasoning_content?: string;
  source: 'system' | 'user' | 'agent';
  step_id: number;
  timestamp: string;
  tool_calls?: ReturnType<typeof toToolCall>[];
}

function toToolCall(tool: ChatToolPayload) {
  let args: unknown;
  try {
    args = JSON.parse(tool.arguments);
  } catch {
    // Preserve malformed model output instead of losing the invocation.
  }
  return {
    arguments: isPlainRecord(args) ? args : {},
    extra: {
      ...(!isPlainRecord(args) && { arguments_raw: tool.arguments }),
      identifier: tool.identifier,
    },
    function_name: `${tool.identifier}${PLUGIN_SCHEMA_SEPARATOR}${tool.apiName}`,
    tool_call_id: tool.id,
  };
}

/** Export persisted interactions, not reconstructed LLM input/context snapshots. */
export function toAtif(transcript: TopicTranscript) {
  const { items, topic } = transcript;
  if (items.length === 0) throw new Error('Cannot export an empty topic as ATIF.');
  if (items.some((message) => !('usage' in message) || !('toolCallId' in message))) {
    throw new Error('The server lacks topic export fields. Update the LobeHub server first.');
  }
  const agentIds = new Set(
    items
      .filter((message) => message.role === 'assistant')
      .map((message) => message.agentId)
      .filter(Boolean),
  );
  if (agentIds.size > 1 || items.some((message) => message.threadId)) {
    throw new Error('ATIF export currently supports single-agent topics without threads.');
  }

  const steps: AtifStep[] = [];
  const calls = new Map<string, AtifStep>();
  const resultCallIds = new Map<string, string>();
  const parents = new Set<string>();
  for (const message of items) {
    if (message.role === 'tool') continue;
    if (!['system', 'user', 'assistant'].includes(message.role)) {
      throw new Error(
        `ATIF export does not support message role: ${message.role} (${message.id}).`,
      );
    }
    if (message.parentId && message.role !== 'system') {
      if (parents.has(message.parentId)) {
        throw new Error('ATIF export currently does not support branched conversations.');
      }
      parents.add(message.parentId);
    }
    const step: AtifStep = {
      extra: {
        error: message.error ?? undefined,
        message_id: message.id,
        parent_id: message.parentId,
      },
      message: message.content ?? '',
      source: message.role === 'assistant' ? 'agent' : (message.role as 'system' | 'user'),
      step_id: steps.length + 1,
      timestamp: new Date(message.createdAt).toISOString(),
    };
    if (message.metadata?.copied) step.is_copied_context = true;
    if (step.source === 'agent') {
      step.model_name = message.model ?? undefined;
      step.extra.provider = message.provider ?? undefined;
      step.reasoning_content = message.reasoning?.content;
      const usage = message.usage ?? message.metadata?.usage ?? message.metadata;
      if (usage) {
        const metrics: AtifMetrics = {
          cached_tokens: usage.inputCachedTokens,
          completion_tokens: usage.totalOutputTokens,
          cost_usd: usage.cost,
          prompt_tokens: usage.totalInputTokens,
        };
        if (Object.values(metrics).some((value) => value !== undefined)) step.metrics = metrics;
      }
      if (message.tools?.length) {
        step.tool_calls = message.tools.map(toToolCall);
        for (const tool of message.tools) {
          if (calls.has(tool.id)) throw new Error(`Duplicate tool call ID: ${tool.id}.`);
          calls.set(tool.id, step);
          if (tool.result_msg_id) resultCallIds.set(tool.result_msg_id, tool.id);
        }
      }
    }
    steps.push(step);
  }

  for (const message of items.filter((item) => item.role === 'tool')) {
    const callId = message.toolCallId ?? resultCallIds.get(message.id);
    const step = callId ? calls.get(callId) : undefined;
    if (!step || !callId) {
      throw new Error(`Cannot associate tool result ${message.id} with its tool call.`);
    }
    step.observation ??= { results: [] };
    step.observation.results.push({
      content: message.content,
      extra: { error: message.error ?? message.pluginError ?? undefined, message_id: message.id },
      source_call_id: callId,
    });
  }

  // A partial sum is not a total. Omit any aggregate whose inputs are incomplete.
  const generatedSteps = steps.filter((step) => step.source === 'agent' && !step.is_copied_context);
  const total = (field: keyof AtifMetrics) => {
    const values = generatedSteps.map((step) => step.metrics?.[field]);
    return values.length > 0 && values.every((value) => value !== undefined)
      ? values.reduce((sum, value) => sum + value, 0)
      : undefined;
  };
  return {
    agent: { name: 'lobehub', version: cliVersion, extra: { agent_id: topic.agentId } },
    extra: { topic_id: topic.id, title: topic.title },
    final_metrics: {
      total_cached_tokens: total('cached_tokens'),
      total_completion_tokens: total('completion_tokens'),
      total_cost_usd: total('cost_usd'),
      total_prompt_tokens: total('prompt_tokens'),
      total_steps: steps.length,
    },
    notes:
      'Text-only persisted topic interactions; excludes attachments, runtime-only context and other topics. Aggregate usage excludes copied context and is omitted when incomplete.',
    schema_version: 'ATIF-v1.7',
    session_id: topic.id,
    steps,
  };
}
