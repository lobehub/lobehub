import type { RenderDisplayControl } from '@lobechat/types';

import { ClaudeCodeApiName } from '../../types';
import {
  isLinearMcpApiName,
  LINEAR_MCP_PREFIX,
  LINEAR_MCP_TOOL_NAMES,
} from '../Inspector/linearMcpLabels';

/**
 * Per-APIName default display control for CC tool renders.
 *
 * CC doesn't ship a LobeChat manifest (its tools come from Anthropic tool_use
 * blocks at runtime), so the store's manifest-based `getRenderDisplayControl`
 * can't reach these. The builtin-tools aggregator exposes them via
 * `getBuiltinRenderDisplayControl` as a fallback.
 */
const FixedClaudeCodeRenderDisplayControls: Record<string, RenderDisplayControl> = {
  [ClaudeCodeApiName.Edit]: 'expand',
  [ClaudeCodeApiName.SendMessage]: 'expand',
  [ClaudeCodeApiName.TaskList]: 'expand',
  [ClaudeCodeApiName.TaskUpdate]: 'expand',
  [ClaudeCodeApiName.TodoWrite]: 'expand',
  [ClaudeCodeApiName.Write]: 'expand',
  ...Object.fromEntries(
    LINEAR_MCP_TOOL_NAMES.map((tool) => [`${LINEAR_MCP_PREFIX}${tool}`, 'expand']),
  ),
};

export const ClaudeCodeRenderDisplayControls: Record<string, RenderDisplayControl> = new Proxy(
  FixedClaudeCodeRenderDisplayControls,
  {
    get: (target, prop) => {
      if (typeof prop !== 'string') return undefined;
      return target[prop] || (isLinearMcpApiName(prop) ? 'expand' : undefined);
    },
  },
);

/** True once a tool_result carries at least one successfully uploaded image. */
const hasUploadedImage = (pluginState?: unknown): boolean => {
  const images = (pluginState as { images?: { url?: string }[] } | undefined)?.images;
  return !!images?.some((image) => !!image.url);
};

/**
 * Display control for a CC tool, refined by the tool_result when the static map
 * alone can't decide.
 *
 * `Read` is the one API whose output shape depends on its target: on an image
 * file it renders uploaded thumbnails, on anything else the source text. A
 * thumbnail is the whole point of the card, so expand it; source text stays
 * collapsed rather than dumping a file into the transcript. `pluginState` is
 * undefined while the call is still in flight, so the card only pops open once
 * the image has actually landed.
 */
export const resolveClaudeCodeRenderDisplayControl = (
  apiName: string,
  pluginState?: unknown,
): RenderDisplayControl | undefined => {
  if (apiName === ClaudeCodeApiName.Read && hasUploadedImage(pluginState)) return 'expand';

  return ClaudeCodeRenderDisplayControls[apiName];
};
