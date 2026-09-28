import {
  buildClaudeCodeDirectEnv,
  sanitizeClaudeCodeDirectArgs,
  sanitizeClaudeCodeDirectEnv,
} from '@lobechat/heterogeneous-agents';
import { CLAUDE_CODE_BASE_ARGS } from '@lobechat/heterogeneous-agents/spawn';
import { formatServerDefaultHeterogeneousModel } from '@lobechat/types';

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
  prepareProviderBinding({ args, env, profileDir, resolution }) {
    if (resolution.protocol !== 'anthropic-messages') {
      throw new Error(`Claude Code cannot use ${resolution.protocol}.`);
    }

    const direct = buildClaudeCodeDirectEnv({
      keyVaults: resolution.runtimeConfig.keyVaults,
      model: resolution.apiConfig.model,
      sdkType: resolution.runtimeConfig.settings.sdkType,
      smallFastModel: resolution.apiConfig.smallFastModel,
    });
    if (direct.error) throw new Error(direct.error);

    return {
      args: [...sanitizeClaudeCodeDirectArgs(args), '--model', resolution.apiConfig.model],
      env: {
        ...sanitizeClaudeCodeDirectEnv(env),
        ...direct.env,
        CLAUDE_CONFIG_DIR: profileDir,
      },
    };
  },
  prepareServerDefaultBinding({ args, endpoint, env, model, profileDir }) {
    const requestModel = formatServerDefaultHeterogeneousModel(model);
    return {
      args: [...sanitizeClaudeCodeDirectArgs(args), '--model', requestModel],
      env: {
        ...sanitizeClaudeCodeDirectEnv(env),
        ANTHROPIC_BASE_URL: `${endpoint}/api/v1/anthropic`,
        ANTHROPIC_MODEL: requestModel,
        ANTHROPIC_SMALL_FAST_MODEL: requestModel,
        CLAUDE_CODE_SUBAGENT_MODEL: requestModel,
        CLAUDE_CONFIG_DIR: profileDir,
      },
      operationTokenEnvKey: 'ANTHROPIC_AUTH_TOKEN',
    };
  },
};
