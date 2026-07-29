import { LINEAR_TOOL_NAMES, LinearInspector } from '@lobechat/shared-tool-ui/inspectors';
import { LinearRender } from '@lobechat/shared-tool-ui/renders';
import type { BuiltinInspector, BuiltinRender } from '@lobechat/types';

// LobeHub built-in Linear skill: tool calls arrive with
// `identifier='linear'` and bare `apiName` like 'get_issue'. The shared
// inspector / render tolerate both bare and MCP-prefixed names, so we just
// register them under every supported tool suffix.
export const LinearIdentifier = 'linear';

export const LinearInspectors: Record<string, BuiltinInspector> = Object.fromEntries(
  LINEAR_TOOL_NAMES.map((name) => [name, LinearInspector]),
);

export const LinearRenders: Record<string, BuiltinRender> = Object.fromEntries(
  LINEAR_TOOL_NAMES.map((name) => [name, LinearRender as BuiltinRender]),
);
