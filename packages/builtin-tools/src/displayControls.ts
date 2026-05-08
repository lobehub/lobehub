import {
  ClaudeCodeIdentifier,
  ClaudeCodeRenderDisplayControls,
} from '@lobechat/builtin-tool-claude-code/client';
import { type RenderDisplayControl } from '@lobechat/types';

import { CodexRenderDisplayControls } from './codex';

// Kept separate from `./renders` so consumers that only need display-control
// fallbacks (e.g. the tool store selector) don't pull in every builtin tool's
// render registry — that graph cycles back through `@/store/tool/selectors`.
const getBuiltinRenderDisplayControls = (): Record<
  string,
  Record<string, RenderDisplayControl>
> => {
  return {
    [ClaudeCodeIdentifier]: ClaudeCodeRenderDisplayControls,
    codex: CodexRenderDisplayControls,
  };
};

export const getBuiltinRenderDisplayControl = (
  identifier?: string,
  apiName?: string,
): RenderDisplayControl | undefined => {
  if (!identifier || !apiName) return undefined;
  return getBuiltinRenderDisplayControls()[identifier]?.[apiName];
};
