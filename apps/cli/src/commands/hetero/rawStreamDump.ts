import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { log } from '../../utils/logger';

export interface RawStreamDumpAttempt {
  /** Flush + close both file streams. Resolves once the bytes are on disk. */
  close: () => Promise<void>;
  writeStderr: (chunk: Buffer) => void;
  writeStdout: (chunk: Buffer) => void;
}

/**
 * Persists the agent process's RAW stdout/stderr — the untouched stream-json,
 * BEFORE the adapter — to disk for post-hoc debugging. The adapted/ingested
 * view can't tell a CC-side empty `tool_result` apart from an adapter
 * extraction bug; the raw dump can.
 *
 * Enabled via `lh hetero exec --raw-dump <dir>`. Each exec gets its own
 * `<dir>/<timestamp>-<operationId>/` session folder; each spawn attempt (the
 * resume retry is a second attempt) writes `<label>.stdout.jsonl` /
 * `<label>.stderr.log`. Fully best-effort: any dump failure is logged and
 * swallowed so it never affects the run or its exit code.
 *
 * Future: the server-side sandbox runner (`spawnHeteroSandbox`) and the
 * desktop device path (`spawnLhHeteroExec`) can pass `--raw-dump` pointing at
 * a collectable location to capture remote runs the same way.
 */
export class RawStreamDump {
  private constructor(private readonly dir: string) {}

  static async create(
    root: string,
    operationId: string,
    meta: Record<string, unknown>,
  ): Promise<RawStreamDump | undefined> {
    try {
      const safeTs = new Date().toISOString().replaceAll(/[.:]/g, '-');
      const dir = path.join(path.resolve(root), `${safeTs}-${operationId}`);
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, 'meta.json'),
        `${JSON.stringify({ ...meta, operationId, startedAt: new Date().toISOString() }, null, 2)}\n`,
      );
      log.info(`Raw stream dump enabled → ${dir}`);
      return new RawStreamDump(dir);
    } catch (err) {
      log.warn(
        `Failed to initialize raw stream dump: ${err instanceof Error ? err.message : String(err)}`,
      );
      return undefined;
    }
  }

  openAttempt(label: string): RawStreamDumpAttempt {
    const stdout = createWriteStream(path.join(this.dir, `${label}.stdout.jsonl`));
    const stderr = createWriteStream(path.join(this.dir, `${label}.stderr.log`));
    // A failed dump write must never crash the run — drop write errors.
    stdout.on('error', () => {});
    stderr.on('error', () => {});
    return {
      close: () =>
        Promise.all([
          new Promise<void>((resolve) => stdout.end(() => resolve())),
          new Promise<void>((resolve) => stderr.end(() => resolve())),
        ]).then(() => undefined),
      writeStderr: (chunk: Buffer) => {
        stderr.write(chunk);
      },
      writeStdout: (chunk: Buffer) => {
        stdout.write(chunk);
      },
    };
  }
}
