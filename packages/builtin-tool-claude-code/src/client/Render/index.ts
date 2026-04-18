import { RunCommandRender } from '@lobechat/shared-tool-ui/renders';
import type { RenderDisplayControl } from '@lobechat/types';

import { ClaudeCodeApiName } from '../../types';
import Edit from './Edit';
import Glob from './Glob';
import Grep from './Grep';
import Read from './Read';
import Skill from './Skill';
import TodoWrite from './TodoWrite';
import Write from './Write';

/**
 * Claude Code Render Components Registry.
 *
 * Maps CC tool names (the `name` on Anthropic `tool_use` blocks) to dedicated
 * visualizations, keyed so `getBuiltinRender('claude-code', apiName)` resolves.
 */
export const ClaudeCodeRenders = {
  // RunCommand already renders `args.command` + combined output the way CC emits —
  // use the shared component directly instead of wrapping it in a re-export file.
  [ClaudeCodeApiName.Bash]: RunCommandRender,
  [ClaudeCodeApiName.Edit]: Edit,
  [ClaudeCodeApiName.Glob]: Glob,
  [ClaudeCodeApiName.Grep]: Grep,
  [ClaudeCodeApiName.Read]: Read,
  [ClaudeCodeApiName.Skill]: Skill,
  [ClaudeCodeApiName.TodoWrite]: TodoWrite,
  [ClaudeCodeApiName.Write]: Write,
};

/**
 * Per-APIName default display control for CC tool renders.
 *
 * CC doesn't ship a LobeChat manifest (its tools come from Anthropic tool_use
 * blocks at runtime), so the store's manifest-based `getRenderDisplayControl`
 * can't reach these. The builtin-tools aggregator exposes this map via
 * `getBuiltinRenderDisplayControl` as a fallback.
 */
export const ClaudeCodeRenderDisplayControls: Record<string, RenderDisplayControl> = {
  [ClaudeCodeApiName.Edit]: 'expand',
  [ClaudeCodeApiName.TodoWrite]: 'expand',
  [ClaudeCodeApiName.Write]: 'expand',
};
