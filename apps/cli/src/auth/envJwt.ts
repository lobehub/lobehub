import { readFileSync } from 'node:fs';

/**
 * Path of a file holding the run's JWT. Codex runs its shell commands with an
 * env built from the user's `[shell_environment_policy]`, which can drop
 * `LOBEHUB_JWT` (`inherit = "core"`). `spawnAgent` therefore hands Codex's
 * shell this path (a per-run 0600 file) instead of the token itself, which
 * would be visible in Codex's argv.
 */
export const JWT_FILE_ENV = 'LOBEHUB_JWT_FILE';

/**
 * Fill `LOBEHUB_JWT` from `LOBEHUB_JWT_FILE` once at startup, so every reader of
 * `LOBEHUB_JWT` (auth source, tRPC/HTTP clients, workspace scope, doctor) sees
 * the same credential.
 *
 * - A non-empty `LOBEHUB_JWT` always wins; the file is not read.
 * - A `LOBEHUB_JWT` that is defined but empty (`LOBEHUB_JWT= lh …`) is an
 *   explicit opt-out: the file is ignored, so the agent's "clear LOBEHUB_JWT
 *   and retry with the machine's login" fallback keeps working.
 * - A missing, unreadable or empty file behaves as if no file were configured.
 */
export const hydrateJwtFromFile = (env: NodeJS.ProcessEnv = process.env): void => {
  if (env.LOBEHUB_JWT !== undefined) return;

  const filePath = env[JWT_FILE_ENV]?.trim();
  if (!filePath) return;

  try {
    const token = readFileSync(filePath, 'utf8').trim();
    if (token) env.LOBEHUB_JWT = token;
  } catch {
    // Missing or unreadable: fall through to the other credential sources.
  }
};
