import { escapeXmlAttr, escapeXmlContent } from '@lobechat/prompts';
import type { ChatToolPayload } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';

import { BaseProcessor } from '../base/BaseProcessor';
import type { PipelineContext } from '../types';

/** Project persisted effective inputs and tool-level guidance into the next prompt. */
export class ToolHookContextProvider extends BaseProcessor {
  readonly name = 'ToolHookContextProvider';

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const result = this.cloneContext(context);
    // Inline single-tool execution can retain raw history instead of going
    // through conversation-flow. Bind durable rows by parent; for in-memory
    // rows without parentId use the nearest preceding caller of that native ID.
    const assistantIndexes = new Map<string, number>();
    result.messages.forEach((message, index) => {
      if (message.role === 'assistant' && message.id) assistantIndexes.set(message.id, index);
    });
    const precedingCallers = new Map<string, number>();
    const projectedCalls = new Set<string>();
    result.messages.forEach((message, index) => {
      if (message.role === 'assistant') {
        message.tools?.forEach((tool: ChatToolPayload) => precedingCallers.set(tool.id, index));
        return;
      }
      if (
        message.role !== 'tool' ||
        !message.tool_call_id ||
        !isRecord(message.pluginState?.hookPreparation) ||
        typeof message.plugin?.arguments !== 'string'
      )
        return;
      const callerIndex = message.parentId
        ? assistantIndexes.get(message.parentId)
        : precedingCallers.get(message.tool_call_id);
      if (callerIndex === undefined) return;
      const key = JSON.stringify([callerIndex, message.tool_call_id]);
      if (projectedCalls.has(key)) return;
      const caller = result.messages[callerIndex];
      if (!caller.tools?.some((tool: ChatToolPayload) => tool.id === message.tool_call_id)) return;
      projectedCalls.add(key);
      const args = message.plugin.arguments;
      result.messages[callerIndex] = {
        ...caller,
        tools: caller.tools.map((tool: ChatToolPayload) =>
          tool.id === message.tool_call_id ? { ...tool, arguments: args } : tool,
        ),
      };
    });
    result.messages = result.messages.map((message) => {
      if (message.role !== 'tool') return message;
      const preparation = message.pluginState?.hookPreparation;
      if (!isRecord(preparation) || !Array.isArray(preparation.additionalContexts)) return message;
      const seen = new Set<string>(
        (message.meta?.toolHookContextIds as string[] | undefined) ?? [],
      );
      const additions: string[] = [];
      for (const fragment of preparation.additionalContexts) {
        if (
          !isRecord(fragment) ||
          typeof fragment.hookId !== 'string' ||
          typeof fragment.text !== 'string'
        )
          continue;
        const key = JSON.stringify([message.id, message.tool_call_id, fragment.hookId]);
        if (seen.has(key)) continue;
        seen.add(key);
        additions.push(
          `<tool_hook_context hook="${escapeXmlAttr(fragment.hookId)}">${escapeXmlContent(fragment.text)}</tool_hook_context>`,
        );
      }
      if (!additions.length) return message;
      const text = additions.join('\n');
      return {
        ...message,
        content:
          typeof message.content === 'string'
            ? `${message.content}\n\n${text}`
            : [...(message.content ?? []), { text, type: 'text' as const }],
        meta: { ...message.meta, toolHookContextIds: [...seen] },
      };
    });
    return this.markAsExecuted(result);
  }
}
