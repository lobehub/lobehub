import { builtinTools } from '@lobechat/builtin-tools';
import { resolveWorkRegistration } from '@lobechat/builtin-tools/workRegistration';

import { stashWorkIntent } from '@/utils/clientWorkIntentStash';

import type { BuiltinToolContext, BuiltinToolResult } from '../types';

/**
 * Manifest-driven Work registration intent for the client tool-execution path
 * (the OSS no-gateway / desktop client-run fallback).
 *
 * The executor no longer writes the Work itself: it only RESOLVES what should be
 * registered (from the API's declarative `work` config + the tool result/args)
 * and stashes the intent keyed by `toolCallId`. `call_tool` drains it and
 * persists the Work version ONCE the tool call's cumulative cost is known, so
 * the version lands with its `cumulativeCost` instead of created cost-less and
 * back-filled — mirroring the server `resolveBuiltinToolWorkIntent`.
 *
 * A no-op for APIs that declare no `work` config or resolve to no targets.
 */
export const stashBuiltinToolWorkIntent = (
  identifier: string,
  apiName: string,
  params: unknown,
  ctx: BuiltinToolContext | undefined,
  result: BuiltinToolResult,
): void => {
  const intent = resolveWorkRegistration(builtinTools, identifier, apiName, {
    args: params,
    result,
  });
  if (!intent) return;

  stashWorkIntent(ctx?.toolCallId, intent);
};
