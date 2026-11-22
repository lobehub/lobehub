import type Anthropic from '@anthropic-ai/sdk';
import type { ToolActivationContext } from '@lobechat/types';
import debug from 'debug';

import { supportsClaudeInlineToolChanges } from '../../../providers/anthropic/modelId';
import type { ChatMethodOptions, ChatStreamPayload } from '../../../types';
import type { AnthropicCompatibleRuntimeContext } from '../../anthropicCompatible/context';

const inlineToolsBeta = 'inline-tools-2026-09-15';
const log = debug('lobe-model-runtime:anthropic:tools');

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
  if (!tools.length || tools.some((tool) => tool.type)) return;
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
    // Anthropic permits a content-bearing system message only at the tail or before an assistant.
    const next = body.messages[index + 1];
    if (next && next.role !== 'assistant') return;
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
    tools: initialTools,
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
  // Build the canonical body once. In particular, resolving an image URL can perform I/O.
  const body = await build(payload);
  const ordinary = { body, headers: options?.requestHeaders };
  if (
    process.env.ANTHROPIC_ENABLE_INLINE_TOOLS !== '1' ||
    !options?.getToolActivationContext ||
    !payload.tools?.length ||
    payload.enabledContextCaching === false ||
    payload.enabledSearch
  )
    return ordinary;

  const actualModel = runtime.withMappedRequestModel({ model: payload.model }, payload.model).model;
  const configured = betaHeader(runtime._options.defaultHeaders);
  if (
    !supportsClaudeInlineToolChanges(actualModel) ||
    (runtime.baseURL.replace(/\/$/, '') !== 'https://api.anthropic.com' &&
      !configured?.split(',').some((token) => token.trim() === inlineToolsBeta))
  )
    return ordinary;

  const context = await options.getToolActivationContext().catch((error: unknown) => {
    log(
      'Resolver failed for model=%s operation=%s error=%s',
      actualModel,
      options.metadata?.operationId,
      error instanceof Error ? error.name : 'unknown',
    );
    return undefined;
  });
  if (!context?.additions.length) {
    log(
      'Ordinary request: no eligible tool changes, model=%s operation=%s',
      actualModel,
      options.metadata?.operationId,
    );
    return ordinary;
  }
  const projected = anchorAdditions(body, context);
  if (!projected) {
    log(
      'Ordinary request: incompatible tools or history, model=%s operation=%s',
      actualModel,
      options.metadata?.operationId,
    );
    return ordinary;
  }
  if (context.system) {
    // Only rewrite a plain system block that survived the provider's conversion verbatim.
    const system = body.system;
    if (
      !Array.isArray(system) ||
      system.length !== 1 ||
      system[0].text !== context.system.current ||
      !context.system.initial.trim()
    ) {
      log(
        'Ordinary request: system prompt changed, model=%s operation=%s',
        actualModel,
        options.metadata?.operationId,
      );
      return ordinary;
    }
    projected.system = [{ ...system[0], text: context.system.initial }];
  }

  log(
    'Inline tool changes=%d model=%s operation=%s',
    context.additions.length,
    actualModel,
    options.metadata?.operationId,
  );
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
