import type { BuiltinInspector } from '@lobechat/types';

import { LinearInspector } from './Inspector';
import { LINEAR_TOOL_NAMES } from './labels';

export { LinearInspector } from './Inspector';
export { formatLinearShortLabel, LINEAR_TOOL_NAMES } from './labels';

// LobeHub built-in Linear skill: tool calls arrive with
// `identifier='linear'` and bare `apiName` like 'get_issue'.
export const LinearIdentifier = 'linear';

export const LinearInspectors: Record<string, BuiltinInspector> = Object.fromEntries(
  LINEAR_TOOL_NAMES.map((name) => [name, LinearInspector]),
);
