import { rmSync } from 'node:fs';
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Codex does not hand its own process env to the commands it runs: every shell
 * command gets an env built from `[shell_environment_policy]` (codex-rs
 * `protocol/src/shell_environment.rs` `populate_env`). With `inherit = "core"`
 * only PATH/HOME/USER/… survive, so the LobeHub run context injected into the
 * Codex process never reaches `lh` inside the agent's shell. `set` entries are
 * applied after `inherit` and the default/custom excludes, so passing the
 * context as `-c shell_environment_policy.set.<KEY>=<value>` reaches the shell
 * under every `inherit` mode while leaving the user's own policy untouched.
 * (`include_only` still filters `set` entries; a user who narrows the shell
 * env that far has opted out of passing anything through.)
 */
export const CODEX_LOBEHUB_CONTEXT_ENV_KEYS = [
  'LOBEHUB_AGENT_ID',
  'LOBEHUB_ASSISTANT_MESSAGE_ID',
  // The desktop's bundled `lh`, for shells that resolve an older global one first.
  'LOBEHUB_CLI',
  'LOBEHUB_OPERATION_ID',
  'LOBEHUB_SERVER',
  'LOBEHUB_TASK_ID',
  'LOBEHUB_TOPIC_ID',
  'LOBEHUB_WORKSPACE_ID',
] as const;

/**
 * Points the CLI at a 0600 file holding the run's JWT. The token itself never
 * goes into Codex argv (readable by any local user through `ps`); only this
 * path does. The `lh` CLI prefers it over an inherited `LOBEHUB_JWT` (only the
 * file follows token renewals) unless `LOBEHUB_JWT` is set empty.
 */
export const LOBEHUB_JWT_FILE_ENV = 'LOBEHUB_JWT_FILE';

const CODEX_SHELL_ENV_SET_PREFIX = 'shell_environment_policy.set.';

/**
 * Encode a value as a TOML basic string. Codex parses a `-c` value as TOML
 * first and only falls back to the raw text (with surrounding quotes stripped)
 * when that fails, so an unquoted URL or an id that happens to be valid TOML
 * (`123`, `true`) would be misread. Escaping `"`, `\` and every control
 * character as `\uXXXX` yields a string TOML and JSON parse identically, which
 * also keeps the desktop app-server path (`parseConfigValue` → JSON.parse)
 * consistent.
 */
export const toTomlBasicString = (value: string): string => {
  let encoded = '"';
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (char === '"' || char === '\\') encoded += `\\${char}`;
    else if (code < 0x20 || code === 0x7f) encoded += `\\u${code.toString(16).padStart(4, '0')}`;
    else encoded += char;
  }
  return `${encoded}"`;
};

export const buildCodexShellEnvSetArgs = (key: string, value: string): string[] => [
  '-c',
  `${CODEX_SHELL_ENV_SET_PREFIX}${key}=${toTomlBasicString(value)}`,
];

/**
 * `-c` overrides that forward the non-secret LobeHub run context present in
 * `env` into Codex's shell commands. Never includes `LOBEHUB_JWT`.
 */
export const buildCodexLobeHubContextArgs = (env: Record<string, string | undefined>): string[] =>
  CODEX_LOBEHUB_CONTEXT_ENV_KEYS.flatMap((key) => {
    const value = env[key];
    return value ? buildCodexShellEnvSetArgs(key, value) : [];
  });

export interface CodexJwtFile {
  /** `-c` override exposing the file path as `LOBEHUB_JWT_FILE` in Codex's shell. */
  args: string[];
  /** Remove the file and its private directory. Idempotent and never throws. */
  cleanup: () => Promise<void>;
  path: string;
}

/** JWT files of runs still in progress, keyed by path, so a renewed token can reach them. */
const liveJwtFiles = new Set<string>();

/**
 * Rewrite every live Codex JWT file with a renewed token. The Codex process and
 * the `lh` commands it runs cannot see the host's `process.env`, so without this
 * a run outliving its operation token keeps handing nested commands the expired
 * one. Each file is replaced atomically, so a concurrent read never sees half a
 * token. Never throws: a file removed mid-write just drops out.
 */
export const refreshCodexJwtFiles = async (jwt: string): Promise<void> => {
  await Promise.all(
    [...liveJwtFiles].map(async (filePath) => {
      const tmpPath = `${filePath}.${process.pid}.tmp`;
      try {
        await writeFile(tmpPath, jwt, { encoding: 'utf8', mode: 0o600 });
        await rename(tmpPath, filePath);
      } catch {
        await rm(tmpPath, { force: true }).catch(() => {});
      }
    }),
  );
};

/**
 * Write the run's JWT to a per-run file only the current user can read: a
 * fresh `mkdtemp` directory (created 0700) holding a 0600 file. The caller
 * must call `cleanup` when the run ends; a synchronous `exit` hook covers the
 * host process dying first (SIGKILL aside).
 */
export const createCodexJwtFile = async (jwt: string): Promise<CodexJwtFile> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lobehub-codex-'));
  const filePath = path.join(dir, 'jwt');
  let removed = false;
  const removeSync = () => {
    if (removed) return;
    removed = true;
    liveJwtFiles.delete(filePath);
    try {
      rmSync(dir, { force: true, recursive: true });
    } catch {
      // best-effort
    }
  };
  process.once('exit', removeSync);

  try {
    await writeFile(filePath, jwt, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch (error) {
    process.off('exit', removeSync);
    removeSync();
    throw error;
  }

  liveJwtFiles.add(filePath);
  return {
    args: buildCodexShellEnvSetArgs(LOBEHUB_JWT_FILE_ENV, filePath),
    cleanup: async () => {
      process.off('exit', removeSync);
      if (removed) return;
      removed = true;
      liveJwtFiles.delete(filePath);
      await rm(dir, { force: true, recursive: true }).catch(() => {});
    },
    path: filePath,
  };
};
