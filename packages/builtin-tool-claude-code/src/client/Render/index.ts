import { RunCommandRender } from '@lobechat/shared-tool-ui/renders';
import type { BuiltinRender, RenderDisplayControl } from '@lobechat/types';

import { ClaudeCodeApiName } from '../../types';
import {
  isLinearMcpApiName,
  LINEAR_MCP_PREFIX,
  LINEAR_MCP_TOOL_NAMES,
} from '../Inspector/linearMcpLabels';
import Agent from './Agent';
import AskUserQuestion from './AskUserQuestion';
import Edit from './Edit';
import Glob from './Glob';
import Grep from './Grep';
import { LinearMcpRenders } from './LinearMcp';
import Read from './Read';
import SendMessage from './SendMessage';
import Skill from './Skill';
import Task from './Task';
import TodoWrite from './TodoWrite';
import WebFetch from './WebFetch';
import WebSearch from './WebSearch';
import Write from './Write';

/**
 * Claude Code Render Components Registry.
 *
 * Maps CC tool names (the `name` on Anthropic `tool_use` blocks) to dedicated
 * visualizations, keyed so `getBuiltinRender('claude-code', apiName)` resolves.
 */
const FixedClaudeCodeRenders = {
  [ClaudeCodeApiName.Agent]: Agent,
  [ClaudeCodeApiName.AskUserQuestion]: AskUserQuestion,
  // RunCommand already renders `args.command` + combined output the way CC emits —
  // use the shared component directly instead of wrapping it in a re-export file.
  [ClaudeCodeApiName.Bash]: RunCommandRender,
  [ClaudeCodeApiName.Edit]: Edit,
  [ClaudeCodeApiName.Glob]: Glob,
  [ClaudeCodeApiName.Grep]: Grep,
  [ClaudeCodeApiName.Read]: Read,
  [ClaudeCodeApiName.SendMessage]: SendMessage,
  [ClaudeCodeApiName.Skill]: Skill,
  // Task panel renders the adapter-synthesized `pluginState.todos` snapshot.
  // Only TaskUpdate / TaskList show it — those events express list-level
  // changes (status flip / full snapshot) where the cumulative panel is
  // genuinely informative. TaskCreate is deliberately skipped: it's a
  // single-task add and the inspector chip already says `Creating task:
  // <subject>`, so the big "Todos N/M" panel adds noise without info.
  // TaskGet is read-only and falls through to the default tool card.
  [ClaudeCodeApiName.TaskList]: Task,
  [ClaudeCodeApiName.TaskUpdate]: Task,
  [ClaudeCodeApiName.TodoWrite]: TodoWrite,
  [ClaudeCodeApiName.WebFetch]: WebFetch,
  [ClaudeCodeApiName.WebSearch]: WebSearch,
  [ClaudeCodeApiName.Write]: Write,
  ...LinearMcpRenders,
};

export const ClaudeCodeRenders = new Proxy(FixedClaudeCodeRenders, {
  get: (target, prop) => {
    if (typeof prop !== 'string') return undefined;
    return prop in target ? target[prop as keyof typeof target] : LinearMcpRenders[prop];
  },
}) as unknown as Record<string, BuiltinRender>;

/**
 * Per-APIName default display control for CC tool renders.
 *
 * CC doesn't ship a LobeChat manifest (its tools come from Anthropic tool_use
 * blocks at runtime), so the store's manifest-based `getRenderDisplayControl`
 * can't reach these. The builtin-tools aggregator exposes this map via
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
