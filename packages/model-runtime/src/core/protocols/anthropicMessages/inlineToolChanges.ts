import type Anthropic from '@anthropic-ai/sdk';
import type { ToolActivationContext } from '@lobechat/types';
import debug from 'debug';

import { supportsClaudeInlineToolChanges } from '../../../providers/anthropic/modelId';
import type { ChatMethodOptions, ChatStreamPayload } from '../../../types';
import type { ConstructorOptions } from '../../anthropicCompatible';
import type { AnthropicCompatibleRuntimeContext } from '../../anthropicCompatible/context';

const inlineToolsBeta = 'inline-tools-2026-09-15';
const log = debug('lobe-model-runtime:anthropic:tools');

/**
 * How a Messages-API endpoint declares a tool that became available mid-conversation.
 *
 * - `tool_definition`: Claude's inline-tools beta. The activated schema leaves the
 *   top-level `tools` list and travels by value inside a `tool_addition` block.
 * - `tool_reference`: DeepSeek's deferred tool loading. The activated schema stays in the
 *   top-level list flagged `defer_loading: true`, which keeps it out of the opening
 *   prompt, and a `tool_addition` block loads it by name where the activation happened.
 *
 * Either way the request only grows at the activation point, so the cached prefix
 * survives the activation.
 *
 * @see https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages
 * @see https://api-docs.deepseek.com/guides/tool_calls#deferred-tool-loading
 */
export type InlineToolChangesMode = 'tool_definition' | 'tool_reference';

export interface InlineToolChangesResolverContext {
  /** Endpoint the request is sent to. */
  baseURL: string;
  /** Upstream model id, after `modelIdMapping`. */
  model: string;
  /** Options the runtime was constructed with, including per-channel overrides. */
  options: ConstructorOptions;
}

/** Picks the mode for one endpoint and model, or `undefined` to keep the ordinary payload. */
export type ResolveInlineToolChanges = (
  context: InlineToolChangesResolverContext,
) => InlineToolChangesMode | undefined;

function betaHeader(headers?: object | null) {
  const entry = Object.entries(headers ?? {}).find(
    ([name]) => name.toLowerCase() === 'anthropic-beta',
  );
  return typeof entry?.[1] === 'string' ? entry[1] : undefined;
}

const hasInlineToolsBeta = (configured?: string) =>
  configured?.split(',').some((token) => token.trim() === inlineToolsBeta) ?? false;

/**
 * Claude's inline tools stay opt-in while the beta lasts: the env enables them, and a
 * relay must also carry the beta header as the operator's statement that it accepts the
 * blocks.
 */
const resolveClaudeInlineToolChanges: ResolveInlineToolChanges = ({ baseURL, model, options }) => {
  if (process.env.ANTHROPIC_ENABLE_INLINE_TOOLS !== '1') return;
  if (!supportsClaudeInlineToolChanges(model)) return;
  if (
    baseURL.replace(/\/$/, '') !== 'https://api.anthropic.com' &&
    !hasInlineToolsBeta(betaHeader(options.defaultHeaders))
  )
    return;
  return 'tool_definition';
};

type ToolAdditionBlock = {
  tool:
    | { definition: Anthropic.Tool; type: 'tool_definition' }
    | { name: string; type: 'tool_reference' };
  type: 'tool_addition';
};

type WireUpdate = {
  content: (({ text: string; type: 'text' } | ToolAdditionBlock) & {
    cache_control?: Anthropic.CacheControlEphemeral;
  })[];
  role: 'system';
};

const toToolAddition = (
  mode: InlineToolChangesMode,
  { cache_control: _marker, ...definition }: Anthropic.Tool,
): ToolAdditionBlock => ({
  tool:
    mode === 'tool_definition'
      ? { definition, type: 'tool_definition' }
      : { name: definition.name, type: 'tool_reference' },
  type: 'tool_addition',
});

function anchorAdditions(
  body: Anthropic.MessageCreateParams,
  context: ToolActivationContext,
  mode: InlineToolChangesMode,
) {
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
      update.content.push(toToolAddition(mode, tool));
      later.add(name);
    }
    updates.set(index, update);
  }

  const initial = (tools as Anthropic.Tool[])
    .filter((tool) => !later.has(tool.name))
    .map(({ cache_control: _marker, ...tool }) => tool);
  // Both endpoints require at least one tool that is available from the start.
  if (!initial.length) return;
  const marker = tools.find((tool) => tool.cache_control)?.cache_control;
  const initialTools = initial.map((tool, i) =>
    marker && i === initial.length - 1 ? { ...tool, cache_control: marker } : tool,
  );
  // A referenced tool must stay declared in the top-level list, deferred. Deferred
  // definitions do not enter the opening prompt, so appending them keeps the prefix.
  const deferredTools =
    mode === 'tool_reference'
      ? (tools as Anthropic.Tool[])
          .filter((tool) => later.has(tool.name))
          .map(
            ({ cache_control: _marker, ...tool }) =>
              ({ ...tool, defer_loading: true }) as Anthropic.Tool,
          )
      : [];
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
  // The stable SDK's MessageParam predates mid-conversation system messages. The REST
  // endpoints accept these typed blocks (Claude under the inline-tools beta).
  return {
    ...body,
    messages: messages as Anthropic.MessageParam[],
    tools: [...initialTools, ...deferredTools],
  };
}

export async function prepareAnthropicToolChanges(
  runtime: AnthropicCompatibleRuntimeContext,
  payload: ChatStreamPayload,
  options: ChatMethodOptions | undefined,
  build: (
    payload: ChatStreamPayload,
  ) => Promise<Anthropic.MessageCreateParams> | Anthropic.MessageCreateParams,
  resolveMode: ResolveInlineToolChanges = resolveClaudeInlineToolChanges,
) {
  // Build the canonical body once. In particular, resolving an image URL can perform I/O.
  const body = await build(payload);
  const ordinary = { body, headers: options?.requestHeaders };
  if (
    !options?.getToolActivationContext ||
    !payload.tools?.length ||
    payload.enabledContextCaching === false ||
    payload.enabledSearch
  )
    return ordinary;

  const actualModel = runtime.withMappedRequestModel({ model: payload.model }, payload.model).model;
  const mode = resolveMode({
    baseURL: runtime.baseURL,
    model: actualModel,
    options: runtime._options,
  });
  if (!mode) return ordinary;

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
  const projected = anchorAdditions(body, context, mode);
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
    'Inline tool changes=%d mode=%s model=%s operation=%s',
    context.additions.length,
    mode,
    actualModel,
    options.metadata?.operationId,
  );
  // Deferred loading is a documented DeepSeek feature and needs no beta header.
  if (mode === 'tool_reference') return { body: projected, headers: options.requestHeaders };

  const betas = new Set(
    [
      betaHeader(runtime._options.defaultHeaders),
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
