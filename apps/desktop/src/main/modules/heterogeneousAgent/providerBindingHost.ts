import { createHash, randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { chmod, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  HeterogeneousProviderBindingReference,
  HeterogeneousProviderBindingResolution,
} from '@lobechat/heterogeneous-agents';

import { HETERO_AGENT_BINDINGS_DIR, HETERO_AGENT_RUNS_DIR } from '@/const/heteroAgent';

import type { HeterogeneousAgentDriver, ProviderBindingFilePlan } from './types';

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * Touched inside each binding profile on every prepare, so profiles orphaned
 * by a deleted provider, a changed endpoint, or an identity-version bump can
 * be garbage-collected by last use instead of accumulating forever.
 */
const LAST_USED_MARKER = '.lobehub-last-used';

/**
 * Matches Claude Code's own transcript retention default (`cleanupPeriodDays`,
 * 30 days): a profile idle longer than its transcripts' native lifetime has
 * nothing worth keeping.
 */
const DEFAULT_PROFILE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

const assertRelativeFilePath = (filePath: string): void => {
  if (!filePath || path.isAbsolute(filePath) || filePath.split(/[\\/]/).includes('..')) {
    throw new Error(
      `Provider binding file path must stay inside its managed directory: ${filePath}`,
    );
  }
};

const writeManagedFiles = async (
  root: string,
  stagingRoot: string,
  files: ProviderBindingFilePlan[] | undefined,
): Promise<void> => {
  for (const file of files ?? []) {
    assertRelativeFilePath(file.path);
    const target = path.join(root, file.path);
    const staging = path.join(stagingRoot, `${hash(file.path)}-${randomUUID()}`);
    await mkdir(path.dirname(target), { mode: DIRECTORY_MODE, recursive: true });
    await writeFile(staging, file.content, { encoding: 'utf8', mode: FILE_MODE });
    await rename(staging, target);
    await chmod(target, FILE_MODE);
  }
};

export interface HostedProviderBinding {
  args: string[];
  bindingKey: string;
  cleanup: () => Promise<void>;
  cleanupSync: () => void;
  env: Record<string, string>;
  profileDir: string;
  runDir: string;
}

export const prepareHostedProviderBinding = async (params: {
  agentType: string;
  appStoragePath: string;
  args: string[];
  driver: HeterogeneousAgentDriver;
  env?: Record<string, string>;
  reference: HeterogeneousProviderBindingReference;
  resolution: HeterogeneousProviderBindingResolution;
  sessionId: string;
}): Promise<HostedProviderBinding> => {
  if (!params.driver.prepareProviderBinding) {
    throw new Error(`${params.agentType} does not implement LobeHub Provider binding.`);
  }

  const identity = [
    'v1',
    params.agentType,
    params.reference.apiConfig.providerId,
    params.resolution.protocol,
    params.resolution.endpoint ?? '',
  ].join('\0');
  const digest = hash(identity);
  const bindingKey = `provider-binding:v1:${digest}`;
  const profileDir = path.join(
    params.appStoragePath,
    HETERO_AGENT_BINDINGS_DIR,
    params.agentType,
    digest,
  );
  const runDir = path.join(params.appStoragePath, HETERO_AGENT_RUNS_DIR, params.sessionId);

  await mkdir(profileDir, { mode: DIRECTORY_MODE, recursive: true });
  await mkdir(runDir, { mode: DIRECTORY_MODE, recursive: true });
  await chmod(profileDir, DIRECTORY_MODE);
  await chmod(runDir, DIRECTORY_MODE);
  // Recorded before the driver plan so even a failed prepare counts as use.
  await writeFile(path.join(profileDir, LAST_USED_MARKER), new Date().toISOString(), {
    encoding: 'utf8',
    mode: FILE_MODE,
  });

  try {
    const plan = await params.driver.prepareProviderBinding({
      args: params.args,
      env: params.env,
      profileDir,
      reference: params.reference,
      resolution: params.resolution,
      runDir,
    });
    await writeManagedFiles(profileDir, runDir, plan.profileFiles);
    await writeManagedFiles(runDir, runDir, plan.runFiles);

    return {
      args: plan.args,
      bindingKey,
      cleanup: () => rm(runDir, { force: true, recursive: true }),
      cleanupSync: () => rmSync(runDir, { force: true, recursive: true }),
      env: plan.env,
      profileDir,
      runDir,
    };
  } catch (error) {
    await rm(runDir, { force: true, recursive: true });
    throw error;
  }
};

const statMtimeMs = async (target: string): Promise<number | undefined> => {
  try {
    return (await stat(target)).mtimeMs;
  } catch {
    return undefined;
  }
};

/**
 * Remove binding profiles that have not been used for `maxAgeMs` (default 30
 * days). Stable profiles are keyed by `(agentType, providerId, protocol,
 * endpoint)` and are never cleaned by the per-run cleanup, so deleting a
 * provider, changing its endpoint, or bumping the identity version would
 * otherwise strand them (with transcripts inside) forever.
 *
 * Profiles are considered used when `prepareHostedProviderBinding` touches
 * their marker at session start; pre-marker profiles fall back to directory
 * mtime. Best-effort: failures skip the entry.
 *
 * @returns absolute paths of the removed profile directories
 */
export const gcHostedProviderBindingProfiles = async (
  appStoragePath: string,
  options: { maxAgeMs?: number; now?: number } = {},
): Promise<string[]> => {
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_PROFILE_MAX_AGE_MS;
  const now = options.now ?? Date.now();
  const bindingsRoot = path.join(appStoragePath, HETERO_AGENT_BINDINGS_DIR);
  const removed: string[] = [];

  let agentDirs: string[];
  try {
    agentDirs = await readdir(bindingsRoot);
  } catch {
    return removed; // no bindings root yet
  }

  for (const agentType of agentDirs) {
    const agentRoot = path.join(bindingsRoot, agentType);
    let profileDirs: string[];
    try {
      profileDirs = await readdir(agentRoot);
    } catch {
      continue;
    }

    for (const digest of profileDirs) {
      const profileDir = path.join(agentRoot, digest);
      const lastUsed =
        (await statMtimeMs(path.join(profileDir, LAST_USED_MARKER))) ??
        (await statMtimeMs(profileDir));
      if (lastUsed === undefined || now - lastUsed <= maxAgeMs) continue;

      try {
        await rm(profileDir, { force: true, recursive: true });
        removed.push(profileDir);
      } catch {
        // best-effort — retried on the next sweep
      }
    }
  }

  return removed;
};
