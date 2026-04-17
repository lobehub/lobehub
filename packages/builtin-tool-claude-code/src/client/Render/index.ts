import { RunCommandRender } from '@lobechat/shared-tool-ui/renders';

import { ClaudeCodeApiName } from '../../types';
import Edit from './Edit';
import Glob from './Glob';
import Grep from './Grep';
import Read from './Read';
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
  [ClaudeCodeApiName.Write]: Write,
};
