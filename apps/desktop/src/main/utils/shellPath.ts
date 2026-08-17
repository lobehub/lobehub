import { execFile } from 'node:child_process';

const SHELL_PATH_DELIMITER = '__LOBE_SHELL_PATH__';
const SHELL_ENV_DELIMITER = '__LOBE_SHELL_ENV__';
const SHELL_PATH_TIMEOUT_MS = 5000;

const shouldImportClaudeCodeBedrockEnv = (key: string) =>
  key.startsWith('AWS_') ||
  key === 'CLAUDE_CODE_USE_BEDROCK' ||
  key === 'CLAUDE_CODE_SKIP_BEDROCK_AUTH' ||
  key === 'ANTHROPIC_MODEL' ||
  key === 'ANTHROPIC_SMALL_FAST_MODEL' ||
  /^ANTHROPIC_DEFAULT_.*_MODEL$/.test(key);

const runLoginShell = (shell: string): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(
      shell,
      [
        '-ilc',
        `printf '${SHELL_PATH_DELIMITER}%s${SHELL_PATH_DELIMITER}' "$PATH"; printf '${SHELL_ENV_DELIMITER}'; env -0; printf '${SHELL_ENV_DELIMITER}'; exit`,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          DISABLE_AUTO_UPDATE: 'true',
          ZSH_TMUX_AUTOSTART: 'false',
          ZSH_TMUX_AUTOSTARTED: 'true',
        },
        timeout: SHELL_PATH_TIMEOUT_MS,
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(stdout);
      },
    );
  });

/**
 * 从登录 shell 恢复 GUI 应用缺失的 PATH 与 Claude Code Bedrock 环境变量。
 * shell 无法读取或没有返回有效值时保留进程中的现有配置。
 */
export const refreshShellEnvironment = async (): Promise<void> => {
  if (process.platform === 'win32') return;

  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh');
  const stdout = await runLoginShell(shell);
  const [, shellPath] = stdout.split(SHELL_PATH_DELIMITER);
  const [, shellEnv] = stdout.split(SHELL_ENV_DELIMITER);

  if (shellPath?.trim()) process.env.PATH = shellPath.trim();

  for (const entry of shellEnv?.split('\0') ?? []) {
    const separatorIndex = entry.indexOf('=');
    if (separatorIndex <= 0) continue;

    const key = entry.slice(0, separatorIndex);
    if (shouldImportClaudeCodeBedrockEnv(key)) {
      process.env[key] = entry.slice(separatorIndex + 1);
    }
  }
};
