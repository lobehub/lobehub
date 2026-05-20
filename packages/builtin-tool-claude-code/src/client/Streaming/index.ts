import { RunCommandRender } from '@lobechat/shared-tool-ui/renders';
import type { BuiltinStreaming } from '@lobechat/types';

import { ClaudeCodeApiName } from '../../types';
import EditRender from '../Render/Edit';
import GlobRender from '../Render/Glob';
import GrepRender from '../Render/Grep';
import ReadRender from '../Render/Read';
import SkillRender from '../Render/Skill';
import TodoWriteRender from '../Render/TodoWrite';
import WriteRender from '../Render/Write';
import AgentStreaming from './Agent';
import { wrapRender } from './wrapRender';

/**
 * Claude Code Streaming Components Registry.
 *
 * Rendered while a CC tool is still executing (args parsed, no tool_result
 * yet). Without an entry here, the tool detail falls back to the generic
 * `Arguments` argument table.
 *
 * - `Agent` has its own bespoke streaming view (drops the result block,
 *   surfaces the subagent thread toggle).
 * - The rest reuse their result Render via `wrapRender`. Those Renders
 *   already gracefully degrade when `content`/`pluginState` are absent
 *   (header-only for Read/Glob/Grep/Skill/Bash; full diff or file body
 *   for Edit/Write since those live in args). Same component for live and
 *   final keeps the UI stable across the result transition.
 */
export const ClaudeCodeStreamings: Record<string, BuiltinStreaming> = {
  [ClaudeCodeApiName.Agent]: AgentStreaming as BuiltinStreaming,
  [ClaudeCodeApiName.Bash]: wrapRender(RunCommandRender),
  [ClaudeCodeApiName.Edit]: wrapRender(EditRender),
  [ClaudeCodeApiName.Glob]: wrapRender(GlobRender),
  [ClaudeCodeApiName.Grep]: wrapRender(GrepRender),
  [ClaudeCodeApiName.Read]: wrapRender(ReadRender),
  [ClaudeCodeApiName.Skill]: wrapRender(SkillRender),
  [ClaudeCodeApiName.TodoWrite]: wrapRender(TodoWriteRender),
  [ClaudeCodeApiName.Write]: wrapRender(WriteRender),
};

export { default as AgentStreaming } from './Agent';
