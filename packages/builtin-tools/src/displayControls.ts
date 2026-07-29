import {
  ClaudeCodeIdentifier,
  resolveClaudeCodeRenderDisplayControl,
} from '@lobechat/builtin-tool-claude-code/client';
import { type RenderDisplayControl } from '@lobechat/types';

import { CodexRenderDisplayControls } from './codex/displayControls';

// Kept separate from `./renders` so consumers that only need display-control
// fallbacks (e.g. the tool store selector) don't pull in every builtin tool's
// render registry — that graph cycles back through `@/store/tool/selectors`.
const getBuiltinRenderDisplayControls = (): Record<
  string,
  Record<string, RenderDisplayControl>
> => {
  return {
    codex: CodexRenderDisplayControls,
  };
};

/**
 * Packages whose display control can't be decided from `apiName` alone — the
 * same API renders differently depending on what its result carries.
 */
const getDynamicRenderDisplayControlResolvers = (): Record<
  string,
  (apiName: string, pluginState?: unknown) => RenderDisplayControl | undefined
> => {
  return {
    [ClaudeCodeIdentifier]: resolveClaudeCodeRenderDisplayControl,
  };
};

export const getBuiltinRenderDisplayControl = (
  identifier?: string,
  apiName?: string,
  pluginState?: unknown,
): RenderDisplayControl | undefined => {
  if (!identifier || !apiName) return undefined;

  const resolve = getDynamicRenderDisplayControlResolvers()[identifier];
  if (resolve) return resolve(apiName, pluginState);

  return getBuiltinRenderDisplayControls()[identifier]?.[apiName];
};
