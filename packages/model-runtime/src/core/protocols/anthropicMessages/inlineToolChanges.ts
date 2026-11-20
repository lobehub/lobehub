import type Anthropic from '@anthropic-ai/sdk';
import type { ToolActivationContext } from '@lobechat/types';
import debug from 'debug';

import type { ChatMethodOptions, ChatStreamPayload } from '../../../types';
import type { AnthropicCompatibleRuntimeContext } from '../../anthropicCompatible/context';

const inlineToolsBeta = 'inline-tools-2026-09-15';
const placeholder = {
  defer_loading: true,
  description: 'Reserved for tool discovery. Never available for execution.',
  input_schema: { properties: {}, type: 'object' as const },
  name: '__lobehub_deferred_placeholder__',
};

// Mid-conversation tool changes require a supported model AND endpoint. Compatible
// proxies opt in per route by advertising the beta in their configured default headers.
// https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages
const inlineToolModels = new Set([
  'claude-opus-4-8',
  'claude-opus-5',
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-haiku-5-5',
  'claude-fable-5',
  'claude-fable-5-1',
  'claude-fable-5-2',
  'claude-mythos-5',
  'claude-mythos-5-1',
  'claude-mythos-5-2',
]);

function betaHeader(headers?: object | null) {
  const entry = Object.entries(headers ?? {}).find(
    ([name]) => name.toLowerCase() === 'anthropic-beta',
  );
  return typeof entry?.[1] === 'string' ? entry[1] : undefined;
}

type WireUpdate = {
  content: ((
    | { text: string; type: 'text' }
    | {
        tool: { definition: Anthropic.Tool; type: 'tool_definition' };
        type: 'tool_addition';
      }
  ) & { cache_control?: Anthropic.CacheControlEphemeral })[];
  role: 'system';
};

function anchorAdditions(body: Anthropic.MessageCreateParams, context: ToolActivationContext) {
  const tools = body.tools ?? [];
  if (!tools.length || tools.some((tool) => tool.type || tool.name === placeholder.name)) return;
  const definitions = new Map((tools as Anthropic.Tool[]).map((tool) => [tool.name, tool]));
  const later = new Set<string>();
  const updates = new Map<number, WireUpdate>();
  for (const addition of context.additions) {
    // The protocol converter can repair or omit orphan results. Anchor against the
    // converted batch so we never separate a tool_use from any of its tool_results.
    const matches = body.messages.flatMap((message, index) =>
      message.role === 'user' &&
      Array.isArray(message.content) &&
      message.content.some(
        (block) => block.type === 'tool_result' && block.tool_use_id === addition.afterToolCallId,
      )
        ? [index]
        : [],
    );
    if (matches.length !== 1) return;
    const index = matches[0];
    const update: WireUpdate = updates.get(index) ?? { role: 'system', content: [] };
    if (addition.instructions) update.content.push({ type: 'text', text: addition.instructions });
    for (const name of addition.names) {
      const tool = definitions.get(name);
      if (!tool || later.has(name)) return;
      const { cache_control: _marker, ...definition } = tool;
      update.content.push({ type: 'tool_addition', tool: { type: 'tool_definition', definition } });
      later.add(name);
    }
    updates.set(index, update);
  }

  const initial = (tools as Anthropic.Tool[])
    .filter((tool) => !later.has(tool.name))
    .map(({ cache_control: _marker, ...tool }) => tool);
  if (!initial.length) return;
  const marker = tools.find((tool) => tool.cache_control)?.cache_control;
  const initialTools = initial.map((tool, i) =>
    marker && i === initial.length - 1 ? { ...tool, cache_control: marker } : tool,
  );
  const messages: (Anthropic.MessageParam | WireUpdate)[] = [];
  for (const [index, message] of body.messages.entries()) {
    const update = updates.get(index);
    if (!update) {
      messages.push(message);
      continue;
    }
    // Keep the history breakpoint on the actual tail, including the newly active tools.
    const parts = message.content;
    const last = Array.isArray(parts) ? parts.at(-1) : undefined;
    const tail = update.content.at(-1);
    if (
      index === body.messages.length - 1 &&
      Array.isArray(parts) &&
      last &&
      'cache_control' in last &&
      last.cache_control &&
      tail
    ) {
      const { cache_control, ...block } = last;
      tail.cache_control = cache_control;
      messages.push({ ...message, content: [...parts.slice(0, -1), block] }, update);
    } else {
      messages.push(message, update);
    }
  }
  // The stable SDK's MessageParam predates beta system messages. The REST endpoint
  // accepts these typed blocks under the inline-tools beta.
  return {
    ...body,
    messages: messages as Anthropic.MessageParam[],
    tools: [...initialTools, placeholder],
  };
}

export async function prepareAnthropicToolChanges(
  runtime: AnthropicCompatibleRuntimeContext,
  payload: ChatStreamPayload,
  options: ChatMethodOptions | undefined,
  build: (
    payload: ChatStreamPayload,
  ) => Promise<Anthropic.MessageCreateParams> | Anthropic.MessageCreateParams,
) {
  const ordinary = async () => ({ body: await build(payload), headers: options?.requestHeaders });
  if (
    !options?.getToolActivationContext ||
    !payload.tools?.length ||
    payload.enabledContextCaching === false ||
    payload.enabledSearch
  )
    return ordinary();
  const actualModel = runtime.withMappedRequestModel({ model: payload.model }, payload.model).model;
  const configured = betaHeader(runtime._options.defaultHeaders);
  if (
    !inlineToolModels.has(
      actualModel
        .replace(/^anthropic\//, '')
        .replace(/-\d{8}$/, '')
        .replaceAll('.', '-'),
    ) ||
    (runtime.baseURL.replace(/\/$/, '') !== 'https://api.anthropic.com' &&
      !configured?.split(',').some((token) => token.trim() === inlineToolsBeta))
  )
    return ordinary();
  const context = await options.getToolActivationContext().catch(() => {
    debug('lobe-model-runtime:anthropic:tools')('Could not reconstruct the initial tool context');
    return undefined;
  });
  if (!context) return ordinary();
  const system = context.system;
  if (system) {
    const first = payload.messages[0];
    if (first?.role !== 'system' || first.content !== system.current) return ordinary();
  }
  const messages = system
    ? [{ ...payload.messages[0], content: system.initial }, ...payload.messages.slice(1)]
    : payload.messages;

  const body = await build({ ...payload, messages });
  const projected = anchorAdditions(body, context);
  if (!projected) return system ? ordinary() : { body, headers: options.requestHeaders };
  const betas = new Set(
    [
      configured,
      process.env.ANTHROPIC_BETA_HEADERS,
      betaHeader(options.requestHeaders),
      inlineToolsBeta,
    ].flatMap(
      (value) =>
        value
          ?.split(',')
          .map((beta) => beta.trim())
          .filter(Boolean) ?? [],
    ),
  );
  const headers = Object.fromEntries(
    Object.entries(options.requestHeaders ?? {}).filter(
      ([key]) => key.toLowerCase() !== 'anthropic-beta',
    ),
  );
  return { body: projected, headers: { ...headers, 'anthropic-beta': [...betas].join(',') } };
}
