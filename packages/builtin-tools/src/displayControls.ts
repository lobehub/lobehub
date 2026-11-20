import { ClaudeCodeIdentifier } from '@lobechat/builtin-tool-claude-code';
import { resolveClaudeCodeRenderDisplayControl } from '@lobechat/builtin-tool-claude-code/client/displayControls';
import { CloudSandboxIdentifier } from '@lobechat/builtin-tool-cloud-sandbox';
import { LocalSystemIdentifier } from '@lobechat/builtin-tool-local-system';
import { resolveLocalSystemRenderDisplayControl } from '@lobechat/builtin-tool-local-system/client/displayControls';
import { type RenderDisplayControl } from '@lobechat/types';

import { CodexRenderDisplayControls } from './codex/displayControls';

const QODER_IDENTIFIER = 'qoder';

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
 *
 * Both file-system hosts are listed because they render the SAME `readFile`
 * card (`LocalSystemRenders.readFile`), so whether an image read opens itself is
 * a property of that card rather than of the host. The heterogeneous CLIs'
 * `read` reuses the card too, but only ever returns text, so it needs no entry.
 */
const getDynamicRenderDisplayControlResolvers = (): Record<
  string,
  (apiName: string, pluginState?: unknown) => RenderDisplayControl | undefined
> => {
  return {
    [ClaudeCodeIdentifier]: resolveClaudeCodeRenderDisplayControl,
    [CloudSandboxIdentifier]: resolveLocalSystemRenderDisplayControl,
    [LocalSystemIdentifier]: resolveLocalSystemRenderDisplayControl,
    [QODER_IDENTIFIER]: resolveClaudeCodeRenderDisplayControl,
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
