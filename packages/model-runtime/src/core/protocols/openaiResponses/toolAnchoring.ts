import type { ToolActivationPlan } from '@lobechat/types';
import type OpenAI from 'openai';

import type { ChatCompletionTool, OpenAIChatMessage } from '../../../types';
import { collectToolCallPairing } from './toolPairing';
import { convertChatCompletionToolToResponseTool } from './tools';

/**
 * How a Responses transport declares a tool that became available mid-conversation.
 *
 * OpenAI renders the top-level `tools` list ahead of the whole input, so appending a tool
 * there changes the first tokens of the prompt and every later token misses the prompt
 * cache. Both modes leave that list alone and declare the new tools at the message that
 * introduced them, which only ever appends to the request:
 *
 * - `additional_tools`: a developer `additional_tools` input item. A later item adds tools
 *   to the ones already declared.
 * - `tool_search`: a client-executed tool search exchange (`tool_search_call` answered by
 *   `tool_search_output`) carrying the tools as deferred definitions. For endpoints that
 *   do not pass `additional_tools` through.
 *
 * Neither mode can remove a tool or replace a top-level definition, so only additions are
 * anchored; a tool whose anchor left the conversation falls back to the top-level list.
 *
 * @see https://github.com/earendil-works/pi/issues/10940
 */
export type ResponsesToolAnchoringMode = 'additional_tools' | 'tool_search';

export interface ResponsesToolAnchors {
  /** Tools first declared at a message, keyed by that message's index. */
  byMessageIndex: Map<number, ChatCompletionTool[]>;
  mode: ResponsesToolAnchoringMode;
}

export interface AnchoredToolSplit<T> {
  /** Tools declared inside the conversation, keyed by the index of their message. */
  anchored: Map<number, ChatCompletionTool[]>;
  /** Tools that stay in the top-level request field, in their original order. */
  requestTools: T[] | undefined;
}

const getFunctionName = (tool: unknown): string | undefined => {
  const candidate = tool as Partial<ChatCompletionTool> | undefined;
  return candidate?.type === 'function' ? candidate.function?.name : undefined;
};

/**
 * Split the request's tools between the top-level field and the messages that announce
 * them through `toolsAdded`.
 *
 * A name is anchored at the first message that announces it, and only when that message
 * is actually sent: an unpaired tool message is dropped under strict pairing, and a tool
 * anchored there would otherwise be declared nowhere. Names that are not in `tools`
 * (filtered for this step, uninstalled since) are ignored.
 */
export const splitAnchoredTools = <T>(
  messages: OpenAIChatMessage[],
  tools: T[] | undefined,
  options?: { strictToolPairing?: boolean },
): AnchoredToolSplit<T> => {
  const anchored = new Map<number, ChatCompletionTool[]>();
  if (!tools?.length || !messages.some((message) => message.toolsAdded?.length)) {
    return { anchored, requestTools: tools };
  }

  const toolsByName = new Map<string, ChatCompletionTool>();
  for (const tool of tools) {
    const name = getFunctionName(tool);
    if (name && !toolsByName.has(name)) toolsByName.set(name, tool as ChatCompletionTool);
  }

  const pairing = options?.strictToolPairing ? collectToolCallPairing(messages) : undefined;
  const anchoredNames = new Set<string>();

  messages.forEach((message, index) => {
    if (!message.toolsAdded?.length) return;
    if (
      pairing &&
      message.role === 'tool' &&
      (!message.tool_call_id || !pairing.pairedToolOutputIds.has(message.tool_call_id))
    )
      return;

    const added: ChatCompletionTool[] = [];
    for (const name of message.toolsAdded) {
      const tool = toolsByName.get(name);
      if (!tool || anchoredNames.has(name)) continue;
      anchoredNames.add(name);
      added.push(tool);
    }
    if (added.length > 0) anchored.set(index, added);
  });

  if (anchoredNames.size === 0) return { anchored, requestTools: tools };

  const requestTools = tools.filter((tool) => {
    const name = getFunctionName(tool);
    return !name || !anchoredNames.has(name);
  });

  return { anchored, requestTools: requestTools.length > 0 ? requestTools : undefined };
};

/**
 * Apply a context-engine plan as one edit, after the runtime has selected its
 * endpoint and tool set. Revalidate the system span and every target because
 * callers can filter messages/tools between context assembly and dispatch.
 */
export const prepareAnchoredMessages = <T>(
  messages: OpenAIChatMessage[],
  tools: T[] | undefined,
  plan: ToolActivationPlan | undefined = messages.find(
    (message) => message.role === 'tool' && message.toolActivationPlan,
  )?.toolActivationPlan,
) => {
  if (!plan?.results.length || !tools?.length) return messages;
  const systemIndex = messages.findIndex((message) =>
    ['system', 'developer'].includes(message.role),
  );
  let editedSystem: string | undefined;
  if (plan.system) {
    const system = messages[systemIndex]?.content;
    const { original, replacement, start } = plan.system;
    if (
      typeof system !== 'string' ||
      !original ||
      !Number.isInteger(start) ||
      start < 0 ||
      !system.startsWith(original, start)
    )
      return messages;
    editedSystem = system.slice(0, start) + replacement + system.slice(start + original.length);
  }
  const available = new Set(tools.map(getFunctionName));
  const byCallId = new Map(plan.results.map((result) => [result.callId, result]));
  const { pairedToolOutputIds } = collectToolCallPairing(
    messages.filter((message) => !message.responsesTools && message.responsesOutput === undefined),
  );
  for (const result of plan.results) {
    if (
      !pairedToolOutputIds.has(result.callId) ||
      !result.toolNames.length ||
      !result.toolNames.every((name) => available.has(name))
    )
      return messages;
  }
  return messages.flatMap((message, index): OpenAIChatMessage[] => {
    if (index === systemIndex && editedSystem !== undefined)
      return editedSystem ? [{ ...message, content: editedSystem }] : [];
    const result =
      message.role === 'tool' && message.tool_call_id
        ? byCallId.get(message.tool_call_id)
        : undefined;
    return result
      ? [{ ...message, content: result.content, toolsAdded: result.toolNames }]
      : [message];
  });
};

/**
 * Precedes every anchored `additional_tools` item. Without it a model can read the item as
 * the complete tool set and stop calling the tools declared before it; Codex precedes its
 * incremental tool batches with the same guidance.
 */
export const INCREMENTAL_TOOLS_NOTICE =
  'This is an incremental tools update. Previously declared tools remain available, and the tools declared next are available in addition to them.';

/**
 * A tool search call id must be stable across requests, or the anchored items change and
 * the cached prefix with them. Derive it from the message that introduced the tools.
 */
const buildToolSearchCallId = (anchorId: string) =>
  `lobe_tool_load_${anchorId.replaceAll(/[^\w-]/g, '_').slice(0, 48)}`;

/**
 * The input items that declare `tools` at their anchor.
 *
 * @param anchorId stable id of the message that introduced the tools
 */
export const buildAnchoredToolItems = (
  mode: ResponsesToolAnchoringMode,
  tools: ChatCompletionTool[],
  anchorId: string,
): OpenAI.Responses.ResponseInputItem[] => {
  const responseTools = tools.map(convertChatCompletionToolToResponseTool);

  if (mode === 'additional_tools') {
    return [
      { content: INCREMENTAL_TOOLS_NOTICE, role: 'developer' },
      { role: 'developer', tools: responseTools, type: 'additional_tools' },
    ];
  }

  const names = tools.map((tool) => tool.function.name);
  const callId = buildToolSearchCallId(anchorId);

  return [
    {
      arguments: { limit: names.length, query: names.join(' ') },
      call_id: callId,
      execution: 'client',
      status: 'completed',
      type: 'tool_search_call',
    },
    {
      call_id: callId,
      execution: 'client',
      status: 'completed',
      // Tool search returns deferred definitions; a result without the flag is rejected.
      tools: responseTools.map(
        (tool) => ({ ...tool, defer_loading: true }) as OpenAI.Responses.Tool,
      ),
      type: 'tool_search_output',
    },
  ];
};

const OFFICIAL_OPENAI_HOST = 'api.openai.com';

const isOfficialOpenAIEndpoint = (baseURL: string | undefined) => {
  if (!baseURL) return true;

  try {
    return new URL(baseURL).hostname === OFFICIAL_OPENAI_HOST;
  } catch {
    return false;
  }
};

/**
 * Tool anchoring for a runtime that talks to OpenAI's public Responses API, possibly
 * through a relay the user configured.
 *
 * A relay may validate or translate the request, and one that does not know the
 * `additional_tools` item fails the whole chat, so only the official endpoint anchors by
 * default. `override` (the `OPENAI_RESPONSES_TOOL_ANCHORING` env) is the operator's
 * answer for everything else: `0` turns anchoring off, `additional_tools` or
 * `tool_search` forces that mode for any endpoint.
 */
export const resolveOpenAIToolAnchoring = ({
  baseURL,
  isSupportedModel,
  override,
}: {
  baseURL?: string;
  isSupportedModel: boolean;
  override?: string;
}): ResponsesToolAnchoringMode | undefined => {
  if (!isSupportedModel) return undefined;

  switch (override?.trim().toLowerCase()) {
    case '0':
    case 'false':
    case 'off': {
      return undefined;
    }
    case '1':
    case 'true':
    case 'additional_tools': {
      return 'additional_tools';
    }
    case 'tool_search': {
      return 'tool_search';
    }
    default: {
      return isOfficialOpenAIEndpoint(baseURL) ? 'additional_tools' : undefined;
    }
  }
};
