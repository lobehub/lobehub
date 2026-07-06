import { constants } from 'node:fs';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
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

  const cacheRoot = deps.skillCacheRoot ?? defaultSkillCacheRoot();
  const extractedDir = path.join(cacheRoot, 'extracted', zipHash);
  const markerPath = path.join(extractedDir, '.prepared');
  const zipPath = path.join(cacheRoot, 'archives', `${zipHash}.zip`);

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

    await rm(extractedDir, { force: true, recursive: true });
    await mkdir(path.dirname(zipPath), { recursive: true });
    await mkdir(extractedDir, { recursive: true });
    await writeFile(zipPath, buffer);

    for (const [relativePath, fileContent] of Object.entries(extractedFiles)) {
      if (relativePath.endsWith('/')) continue;

      const targetPath = path.resolve(extractedDir, relativePath);
      const normalizedRoot = `${path.resolve(extractedDir)}${path.sep}`;
      if (targetPath !== path.resolve(extractedDir) && !targetPath.startsWith(normalizedRoot)) {
        throw new Error(`Unsafe file path in skill archive: ${relativePath}`);
      }

      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, Buffer.from(fileContent as Uint8Array));
    }

    await writeFile(markerPath, JSON.stringify({ preparedAt: Date.now(), url, zipHash }), 'utf8');

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
