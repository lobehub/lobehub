import { createHash, randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  HeterogeneousProviderBindingReference,
  HeterogeneousProviderBindingResolution,
} from '@lobechat/heterogeneous-agents';

import { HETERO_AGENT_BINDINGS_DIR, HETERO_AGENT_RUNS_DIR } from '@/const/heteroAgent';

import type { HeterogeneousAgentDriver, ProviderBindingFilePlan } from './types';

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

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
