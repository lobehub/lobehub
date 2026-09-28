/**
 * Reads a finished Kimi Code run's usage from its session wire log on disk.
 * Node-only — keep it out of anything the browser bundle can reach (adapters,
 * the package root). The spawn pipeline calls it after the CLI exits.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { KimiCodeSessionUsage } from './usage';
import { aggregateKimiCodeUsage, parseKimiCodeWireUsage } from './usage';

type KimiCodeEnv = Record<string, string | undefined>;

export interface ReadKimiCodeSessionUsageOptions {
  env?: KimiCodeEnv;
  homeDir?: string;
  /**
   * The CLI may still be flushing the wire log right after process exit, so
   * the read retries while no usage is found. Defaults to 3 attempts.
   */
  maxAttempts?: number;
  /** Delay between attempts. Defaults to 400ms (~1s total budget). */
  retryDelayMs?: number;
}

export const getKimiCodeHome = (
  env: KimiCodeEnv = process.env,
  homeDir: string = os.homedir(),
): string => {
  const configured = env.KIMI_CODE_HOME?.trim();
  return configured || path.join(homeDir, '.kimi-code');
};

/**
 * Locate the session's `agents/main/wire.jsonl` under the Kimi home.
 * Sessions live at `sessions/<wd_key>/<session_id>/`; the working-directory
 * key segment is derived from the cwd and not reconstructable here, so match
 * every session bucket and keep the newest.
 */
const findWireLog = async (kimiHome: string, sessionId: string): Promise<string | undefined> => {
  let buckets;
  try {
    buckets = await readdir(path.join(kimiHome, 'sessions'), { withFileTypes: true });
  } catch {
    return;
  }

  const candidates = await Promise.all(
    buckets
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const file = path.join(
          kimiHome,
          'sessions',
          entry.name,
          sessionId,
          'agents',
          'main',
          'wire.jsonl',
        );
        try {
          const info = await stat(file);
          return info.isFile() ? { file, mtimeMs: info.mtimeMs } : undefined;
        } catch {
          return;
        }
      }),
  );

  const matches = candidates.filter((item): item is { file: string; mtimeMs: number } => !!item);
  matches.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return matches[0]?.file;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Read the aggregated token usage (and the model it was consumed with) for a
 * finished Kimi Code run from its session wire log. Best-effort by contract:
 * any failure (no session id, missing home/log, parse errors) resolves to
 * `undefined` and never throws.
 */
export const readKimiCodeSessionUsage = async (
  sessionId: string | undefined,
  {
    env = process.env,
    homeDir,
    maxAttempts = 3,
    retryDelayMs = 400,
  }: ReadKimiCodeSessionUsageOptions = {},
): Promise<KimiCodeSessionUsage | undefined> => {
  if (!sessionId) return;

  const kimiHome = getKimiCodeHome(env, homeDir);
  const attempts = Math.max(1, maxAttempts);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const wireLog = await findWireLog(kimiHome, sessionId);
    if (wireLog) {
      const content = await readFile(wireLog, 'utf8').catch(() => undefined);
      const result = content ? aggregateKimiCodeUsage(parseKimiCodeWireUsage(content)) : undefined;
      if (result) return result;
    }
    if (attempt < attempts - 1) await sleep(retryDelayMs);
  }
};
