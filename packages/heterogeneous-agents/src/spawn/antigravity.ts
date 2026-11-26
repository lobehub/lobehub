/** A Connect service can inherit an old SSH session that makes agy skip the desktop keyring. */
export const getAntigravitySpawnEnv = <T extends Record<string, string | undefined>>(env: T): T => {
  if (env.LOBEHUB_CONNECT_SERVICE !== '1') return env;

  const childEnv = { ...env };
  delete childEnv.SSH_CLIENT;
  delete childEnv.SSH_CONNECTION;
  delete childEnv.SSH_TTY;
  return childEnv;
};

/**
 * Flags LobeHub owns: the ACP session carries the prompt, output and
 * conversation, and `agy acp` has no per-run `--settings`.
 */
const MANAGED_FLAGS = new Set([
  '--',
  '--continue',
  '--conversation',
  '--input-format',
  '--output-format',
  '--print',
  '--prompt',
  '--prompt-interactive',
  '--remote-control',
  '--settings',
  '-c',
  '-i',
  '-p',
]);

/** Selector flags applied through ACP `session/set_config_option` instead of argv. */
const SESSION_CONFIG_FLAGS = {
  '--effort': 'effort',
  '--mode': 'mode',
  '--model': 'model',
} as const;

export interface AntigravityAcpLaunch {
  /** Full `agy` argv. */
  args: string[];
  effort?: string;
  mode?: string;
  model?: string;
}

/**
 * Split user/selector args into the `agy acp` argv and the session options
 * ACP sets per session (`--model` full ids such as `gemini-4-neon-xhigh`,
 * `--effort`, `--mode`). Tool permissions are always auto-approved, as the
 * print-mode runs were.
 */
export const buildAntigravityAcpLaunch = (extraArgs: string[] = []): AntigravityAcpLaunch => {
  const launch: AntigravityAcpLaunch = { args: ['acp', '--dangerously-skip-permissions'] };

  for (let index = 0; index < extraArgs.length; index += 1) {
    const arg = extraArgs[index];
    const [flag, inlineValue] = arg.split(/=(.*)/s, 2);
    if (MANAGED_FLAGS.has(flag)) {
      throw new Error(`LobeHub manages Antigravity's prompt, session and settings flags: ${flag}`);
    }

    const key = SESSION_CONFIG_FLAGS[flag as keyof typeof SESSION_CONFIG_FLAGS];
    if (!key) {
      if (arg !== '--dangerously-skip-permissions') launch.args.push(arg);
      continue;
    }

    const value = inlineValue ?? extraArgs[++index];
    if (!value?.trim()) throw new Error(`Antigravity flag ${flag} needs a value`);
    launch[key] = value.trim();
  }

  return launch;
};
