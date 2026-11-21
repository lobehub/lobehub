import { buildClaudeCodePermissionArgs } from '@lobechat/heterogeneous-agents/claudeCodePermission';
import {
  buildClaudeCodeDirectEnv,
  CLAUDE_CODE_BASE_ARGS,
  prepareClaudeCodeLobeHubCli,
  sanitizeClaudeCodeDirectArgs,
  sanitizeClaudeCodeDirectEnv,
} from '@lobechat/heterogeneous-agents/spawn';
import { formatServerDefaultHeterogeneousModel } from '@lobechat/types';

import type { HeterogeneousAgentBuildPlanParams, HeterogeneousAgentDriver } from '../types';

// Desktop renders the chat bubble live, so it always wants partial deltas.
// Compose the shared invariant base args (`@lobechat/heterogeneous-agents/spawn`)
// with that caller-specific flag; permission flags depend on the run's mode.
const DESKTOP_CLAUDE_CODE_ARGS = [...CLAUDE_CODE_BASE_ARGS, '--include-partial-messages'] as const;

export const claudeCodeDriver: HeterogeneousAgentDriver = {
  async buildSpawnPlan({
    args,
    cliVersion,
    helpers,
    mcpConfigPath,
    permissionMode,
    permissionPrompts,
    promptInput,
    resumeSessionId,
  }: HeterogeneousAgentBuildPlanParams) {
    // The `lh` guide rides along as a skill, not as text in the user's turn.
    const lobeHubCli = await prepareClaudeCodeLobeHubCli(promptInput, args, {
      resumed: Boolean(resumeSessionId),
      version: cliVersion,
    });
    const { stdin: stdinPayload } = await helpers.buildAgentInput('claude-code', lobeHubCli.prompt);

    return {
      args: [
        ...DESKTOP_CLAUDE_CODE_ARGS,
        // Lab off (no mode): every action allowed, as before. With a mode the
        // host answers Claude Code's prompts over stdio.
        ...buildClaudeCodePermissionArgs({
          hostPrompts: permissionPrompts ?? true,
          mode: permissionMode,
        }),
        // Wire the controller-managed temp mcp.json (AskUserQuestion server,
        // see ) when present. Path-based config is required — CC
        // does not accept inline JSON for `--mcp-config`.
        ...(mcpConfigPath ? ['--mcp-config', mcpConfigPath] : []),
        ...(resumeSessionId ? ['--resume', resumeSessionId] : []),
        // Input stays open (see `liveInput` below), and a live session replays
        // each message it reads: how a delivered message is known to be picked up.
        '--replay-user-messages',
        ...lobeHubCli.args,
        ...args,
      ],
      // Like `lh hetero exec`, Claude Code always keeps its input open: it is
      // the control channel (stop one background task, deliver a steer) and
      // what keeps background tasks alive past the turn. Whether queued
      // messages are written mid-run is the Follow-up mode's call, not this.
      liveInput: true,
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
