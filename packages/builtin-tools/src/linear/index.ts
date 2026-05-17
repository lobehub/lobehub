import { LINEAR_TOOL_NAMES, LinearInspector } from '@lobechat/shared-tool-ui/inspectors';
import type { BuiltinInspector } from '@lobechat/types';

// LobeHub built-in Linear skill: tool calls arrive with
// `identifier='linear'` and bare `apiName` like 'get_issue'. The shared
// inspector tolerates both bare and MCP-prefixed names, so we just register
// it under every supported tool suffix.
export const LinearIdentifier = 'linear';

export const LinearInspectors: Record<string, BuiltinInspector> = Object.fromEntries(
  LINEAR_TOOL_NAMES.map((name) => [name, LinearInspector]),
);
