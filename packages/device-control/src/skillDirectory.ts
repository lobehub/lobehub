import { constants } from 'node:fs';
import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import path from 'node:path';

import { unzipSync } from 'fflate';

import type {
  PrepareSkillDirectoryParams,
  PrepareSkillDirectoryResult,
  SkillDirectoryDeps,
} from './types';

/**
 * Portable default cache root, following the CLI's `~/.lobehub` convention
 * (see `apps/cli/src/settings`). The desktop injects its
 * `<appStoragePath>/file-storage/skills` dir instead so the gateway RPC path
 * shares one cache with the renderer-IPC path (`LocalFileCtr`).
 */
export const defaultSkillCacheRoot = () => path.join(os.homedir(), '.lobehub', 'skills');

/**
 * In-flight preparations keyed by extraction dir. Concurrent same-hash calls
 * (e.g. two execScript tool calls batched in one step, or a forceRefresh
 * racing a cache miss) would otherwise both miss the `.prepared` marker and
 * interleave rm/extract on the live cache path — deleting files out from
 * under a command that already received that directory as its cwd. Chaining
 * serializes them per key; the follower then hits the marker fast-path.
 * In-process is enough: the desktop main process and the CLI daemon use
 * separate cache roots, so a key is never contended across processes.
 */
const inflightPrepares = new Map<string, Promise<PrepareSkillDirectoryResult>>();

/**
 * Download and extract a skill archive into the device-local cache, keyed by
 * `zipHash` with a `.prepared` marker for idempotency. Shared by the desktop
 * main process (renderer IPC + gateway RPC) and the CLI daemon so both hosts
 * expose the same skill-execution surface.
 *
 * Layout mirrors the original desktop implementation (`LocalFileCtr`):
 * `<cacheRoot>/extracted/<zipHash>/` + `<cacheRoot>/archives/<zipHash>.zip`.
 */
export const prepareSkillDirectory = async (
  params: PrepareSkillDirectoryParams,
  deps: SkillDirectoryDeps = {},
): Promise<PrepareSkillDirectoryResult> => {
  const { forceRefresh, url, zipHash } = params;

  // `zipHash` arrives over the device RPC channel and keys filesystem paths —
  // including a recursive rm of the extraction dir on refresh — so reject
  // anything that isn't a plain content-hash-like token before deriving any
  // path (defense in depth alongside the zip-slip guard below).
  if (!/^[\w-]+$/.test(zipHash)) {
    return {
      error: `Invalid zipHash: expected a content hash, got "${zipHash}"`,
      extractedDir: '',
      success: false,
      zipPath: '',
    };
  }

  const cacheRoot = deps.skillCacheRoot ?? defaultSkillCacheRoot();
  const extractedDir = path.join(cacheRoot, 'extracted', zipHash);
  const markerPath = path.join(extractedDir, '.prepared');
  const zipPath = path.join(cacheRoot, 'archives', `${zipHash}.zip`);

  const run = async (): Promise<PrepareSkillDirectoryResult> => {
    try {
      if (!forceRefresh) {
        await access(markerPath, constants.F_OK);
        return { extractedDir, success: true, zipPath };
      }
    } catch {
      // Cache miss, continue preparing the local copy.
    }

    try {
      const fetchImpl = deps.fetchSkillArchive ?? fetch;
      const response = await fetchImpl(url);
      if (!response.ok) {
        throw new Error(
          `Failed to download skill package: ${response.status} ${response.statusText}`,
        );
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const extractedFiles = unzipSync(new Uint8Array(buffer));

      // Extract into a staging dir and swap it in with a rename: the live
      // cache path never exposes a partially written tree, and the window
      // where a running command's cwd is replaced shrinks from the whole
      // download+extract to two metadata ops. The zipHash validation above
      // (no leading dot allowed) guarantees staging dirs can't collide with
      // real hash dirs.
      const stagingDir = path.join(cacheRoot, 'extracted', `.staging-${zipHash}`);
      await rm(stagingDir, { force: true, recursive: true });
      await mkdir(path.dirname(zipPath), { recursive: true });
      await mkdir(stagingDir, { recursive: true });
      await writeFile(zipPath, buffer);

      for (const [relativePath, fileContent] of Object.entries(extractedFiles)) {
        if (relativePath.endsWith('/')) continue;

        const targetPath = path.resolve(stagingDir, relativePath);
        const normalizedRoot = `${path.resolve(stagingDir)}${path.sep}`;
        if (targetPath !== path.resolve(stagingDir) && !targetPath.startsWith(normalizedRoot)) {
          throw new Error(`Unsafe file path in skill archive: ${relativePath}`);
        }

        await mkdir(path.dirname(targetPath), { recursive: true });
        await writeFile(targetPath, Buffer.from(fileContent as Uint8Array));
      }

      await writeFile(
        path.join(stagingDir, '.prepared'),
        JSON.stringify({ preparedAt: Date.now(), url, zipHash }),
        'utf8',
      );

      await rm(extractedDir, { force: true, recursive: true });
      await rename(stagingDir, extractedDir);

      return { extractedDir, success: true, zipPath };
    } catch (error) {
      return {
        error: (error as Error).message,
        extractedDir,
        success: false,
        zipPath,
      };
    }
  };

  // Serialize per extraction dir (see inflightPrepares). `run` never rejects,
  // so chaining with `.then(run)` is safe.
  const previous = inflightPrepares.get(extractedDir);
  const task = previous ? previous.then(run) : run();
  inflightPrepares.set(extractedDir, task);
  try {
    return await task;
  } finally {
    if (inflightPrepares.get(extractedDir) === task) inflightPrepares.delete(extractedDir);
  }
};
