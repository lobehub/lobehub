import { spawn } from 'node:child_process';
import path from 'node:path';

import { detectHeterogeneousCliCommand } from '@lobechat/heterogeneous-agents/resolveCliCommand';

import { HETERO_AGENT_CLAUDE_ACCOUNTS_DIR } from '@/const/heteroAgent';
import type { App } from '@/core/App';
import { buildProxyEnv } from '@/modules/networkProxy/envBuilder';

import { ClaudeCodeAccountProfiles, resolveDefaultClaudeConfigDir } from './claudeCodeAccounts';

/**
 * Bind the account profiles to this desktop: profiles live under the app's
 * storage, and the login runs the same `claude` binary (and PATH / proxy) a
 * session would. `inheritedEnv` is the session spawn's inherited env, so an
 * exported `ANTHROPIC_API_KEY` cannot hijack the login either.
 */
export const createClaudeCodeAccountProfiles = (
  app: App,
  inheritedEnv: () => NodeJS.ProcessEnv,
): ClaudeCodeAccountProfiles =>
  new ClaudeCodeAccountProfiles({
    defaultConfigDir: resolveDefaultClaudeConfigDir(inheritedEnv()),
    root: path.join(app.appStoragePath, HETERO_AGENT_CLAUDE_ACCOUNTS_DIR),
    spawnLogin: async ({ args, configDir }) => {
      const status = await detectHeterogeneousCliCommand('claude-code', 'claude');
      if (!status.available || !status.path) throw new Error('Claude Code CLI is not installed');

      return spawn(status.path, args, {
        env: {
          ...inheritedEnv(),
          ...(status.resolvedPathEnv ? { PATH: status.resolvedPathEnv } : {}),
          ...buildProxyEnv(app.storeManager.get('networkProxy')),
          CLAUDE_CONFIG_DIR: configDir,
        },
        // No TTY: the CLI opens the browser and waits for its localhost
        // OAuth callback instead of prompting for a pasted code.
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    },
  });
