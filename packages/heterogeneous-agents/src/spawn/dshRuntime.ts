import { rmSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { boot, installFailLoud, loadEnv } from '@deepseek-ai/dsh-app-boot';

import { DSH_RUNTIME_CONFIG } from './dshRuntimeConfig';

const RUNTIME_NAME = 'lobehub-dsh-runtime';

export interface DshRuntimeProcess {
  dispose: (code: number) => Promise<void>;
}

/** Boot LobeHub's closed DSH composition and reserve stdout for JSON-RPC. */
export const runDshRuntime = async (): Promise<DshRuntimeProcess> => {
  installFailLoud(RUNTIME_NAME);
  loadEnv(RUNTIME_NAME);

  const configDirectory = await mkdtemp(path.join(tmpdir(), 'lobehub-dsh-runtime-'));
  const configPath = path.join(configDirectory, 'cordis.yml');
  await writeFile(configPath, DSH_RUNTIME_CONFIG, 'utf8');
  const cleanupConfig = (): void => rmSync(configDirectory, { force: true, recursive: true });
  process.once('exit', cleanupConfig);

  let context: Awaited<ReturnType<typeof boot>>;
  try {
    context = await boot(RUNTIME_NAME, configPath, undefined, undefined, import.meta.url);
  } catch (error) {
    process.off('exit', cleanupConfig);
    await rm(configDirectory, { force: true, recursive: true });
    throw error;
  }

  let disposeTask: Promise<void> | undefined;
  const dispose = (code: number): Promise<void> => {
    disposeTask ??= (async () => {
      try {
        await context.fiber.dispose();
      } finally {
        process.off('exit', cleanupConfig);
        await rm(configDirectory, { force: true, recursive: true });
        process.exitCode = code;
      }
    })();
    return disposeTask;
  };

  return { dispose };
};
