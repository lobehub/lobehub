import { CLAUDE_CODE_BASE_ARGS } from '@lobechat/heterogeneous-agents/spawn';

import type { HeterogeneousAgentBuildPlanParams, HeterogeneousAgentDriver } from '../types';

// Desktop runs CC as the user (never root, so bypassPermissions is fine) and
// renders the chat bubble live, so it always wants partial deltas. Compose
// the shared invariant base args (`@lobechat/heterogeneous-agents/spawn`)
// with those caller-specific flags.
const DESKTOP_CLAUDE_CODE_ARGS = [
  ...CLAUDE_CODE_BASE_ARGS,
  '--include-partial-messages',
  '--permission-mode',
  'bypassPermissions',
] as const;

export const claudeCodeDriver: HeterogeneousAgentDriver = {
  async buildSpawnPlan({
    args,
    helpers,
    mcpConfigPath,
    promptInput,
    resumeSessionId,
  }: HeterogeneousAgentBuildPlanParams) {
    const { stdin: stdinPayload } = await helpers.buildAgentInput('claude-code', promptInput);

    return {
      args: [
        ...DESKTOP_CLAUDE_CODE_ARGS,
        // Wire the controller-managed temp mcp.json (AskUserQuestion server,
        // see ) when present. Path-based config is required — CC
        // does not accept inline JSON for `--mcp-config`.
        ...(mcpConfigPath ? ['--mcp-config', mcpConfigPath] : []),
        ...(resumeSessionId ? ['--resume', resumeSessionId] : []),
        ...args,
      ],
      stdinPayload,
    };
  },
};
