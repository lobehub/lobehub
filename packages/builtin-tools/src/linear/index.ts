import type { BuiltinInspector } from '@lobechat/types';

import { LinearInspector } from './Inspector';
import { LINEAR_MCP_PREFIX, LINEAR_TOOL_NAMES } from './labels';

export { LinearInspector } from './Inspector';
export { formatLinearShortLabel, LINEAR_MCP_PREFIX, LINEAR_TOOL_NAMES } from './labels';

// LobeHub built-in Linear skill: tool calls arrive with
// `identifier='linear'` and bare `apiName` like 'get_issue'.
export const LinearIdentifier = 'linear';

export const LinearInspectors: Record<string, BuiltinInspector> = Object.fromEntries(
  LINEAR_TOOL_NAMES.map((name) => [name, LinearInspector]),
);

// CC adapter variant: the claude.ai Linear MCP server prefixes every tool
// name. Registered under the CC identifier so the same branded inspector
// renders for `mcp__claude_ai_Linear__<verb>_<noun>` calls.
export const LinearMcpInspectors: Record<string, BuiltinInspector> = Object.fromEntries(
  LINEAR_TOOL_NAMES.map((name) => [`${LINEAR_MCP_PREFIX}${name}`, LinearInspector]),
);
