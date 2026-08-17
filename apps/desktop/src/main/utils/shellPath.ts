import { execFile } from 'node:child_process';

import { detectWindowsShell } from '@lobechat/local-file-shell/shell';

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

const importClaudeCodeBedrockEnv = (env: Record<string, string>) => {
  for (const [key, value] of Object.entries(env)) {
    if (shouldImportClaudeCodeBedrockEnv(key)) process.env[key] = value;
  }
};

const parseEnvEntry = (entry: string): [string, string] | undefined => {
  const separatorIndex = entry.indexOf('=');
  if (separatorIndex <= 0) return;

  return [entry.slice(0, separatorIndex), entry.slice(separatorIndex + 1)];
};

const runCommand = (command: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      args,
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

const runLoginShell = (shell: string): Promise<string> =>
  runCommand(shell, [
    '-ilc',
    `printf '${SHELL_PATH_DELIMITER}%s${SHELL_PATH_DELIMITER}\n' "$PATH"; env | while IFS= read -r env_entry; do case "$env_entry" in AWS_*=*|CLAUDE_CODE_USE_BEDROCK=*|CLAUDE_CODE_SKIP_BEDROCK_AUTH=*|ANTHROPIC_MODEL=*|ANTHROPIC_SMALL_FAST_MODEL=*|ANTHROPIC_DEFAULT_*_MODEL=*) printf '${SHELL_ENV_DELIMITER}%s\n' "$env_entry" ;; esac; done`,
  ]);

const parseLoginShellEnv = (stdout: string): Record<string, string> => {
  const env: Record<string, string> = {};

  for (const segment of stdout.split(SHELL_ENV_DELIMITER).slice(1)) {
    const parsed = parseEnvEntry(segment.split(/\r?\n/, 1)[0]);
    if (parsed) env[parsed[0]] = parsed[1];
  }

  return env;
};

const runWindowsShell = async (): Promise<string | undefined> => {
  const shell = await detectWindowsShell();
  if (shell.type !== 'powershell' && shell.type !== 'pwsh') return;

  const script = [
    "$userEnv = [Environment]::GetEnvironmentVariables('User')",
    "foreach ($entry in $userEnv.GetEnumerator()) { [Environment]::SetEnvironmentVariable([string]$entry.Key, [string]$entry.Value, 'Process') }",
    '$profilePaths = @($PROFILE.CurrentUserAllHosts, $PROFILE.CurrentUserCurrentHost) | Select-Object -Unique',
    'foreach ($profilePath in $profilePaths) { if (Test-Path -LiteralPath $profilePath) { . $profilePath } }',
    '$envMap = @{}',
    "Get-ChildItem Env: | Where-Object { $_.Name -like 'AWS_*' -or $_.Name -eq 'CLAUDE_CODE_USE_BEDROCK' -or $_.Name -eq 'CLAUDE_CODE_SKIP_BEDROCK_AUTH' -or $_.Name -eq 'ANTHROPIC_MODEL' -or $_.Name -eq 'ANTHROPIC_SMALL_FAST_MODEL' -or $_.Name -like 'ANTHROPIC_DEFAULT_*_MODEL' } | ForEach-Object { $envMap[$_.Name] = $_.Value }",
    `Write-Output '${SHELL_ENV_DELIMITER}'`,
    '$envMap | ConvertTo-Json -Compress',
    `Write-Output '${SHELL_ENV_DELIMITER}'`,
  ].join('; ');

  return runCommand(shell.path, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script]);
};

const parseWindowsShellEnv = (stdout: string): Record<string, string> => {
  const [, serializedEnv] = stdout.split(SHELL_ENV_DELIMITER);
  if (!serializedEnv?.trim()) return {};

  const parsed = JSON.parse(serializedEnv) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(parsed).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
};

/**
 * Restore PATH and Claude Code Bedrock variables that GUI-launched apps do not inherit.
 * Preserve the current process environment when the user shell returns no usable value.
 */
export const refreshShellEnvironment = async (): Promise<void> => {
  if (process.platform === 'win32') {
    const stdout = await runWindowsShell();
    if (stdout) importClaudeCodeBedrockEnv(parseWindowsShellEnv(stdout));
    return;
  }

  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh');
  const stdout = await runLoginShell(shell);
  const [, shellPath] = stdout.split(SHELL_PATH_DELIMITER);

  if (shellPath?.trim()) process.env.PATH = shellPath.trim();
  importClaudeCodeBedrockEnv(parseLoginShellEnv(stdout));
};
