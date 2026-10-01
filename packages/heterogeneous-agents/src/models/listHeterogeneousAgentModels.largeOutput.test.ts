import { afterEach, expect, it, vi } from 'vitest';

import * as cliSpawn from '../spawn/cliSpawn';
import * as cliCommand from '../spawn/resolveCliCommand';
import { listHeterogeneousAgentModels } from './listHeterogeneousAgentModels';

afterEach(() => {
  vi.restoreAllMocks();
});

it('discovers the complete Devin catalog when CLI output exceeds 256 KiB', async () => {
  const variants = Array.from({ length: 600 }, (_, index) => ({
    label: `Model ${index}`,
    model_uid: `model-${index}`,
    description: 'Model metadata '.repeat(40),
  }));
  const stdout = JSON.stringify({ families: [{ variants }] });
  expect(Buffer.byteLength(stdout)).toBeGreaterThan(256 * 1024);

  vi.spyOn(cliCommand, 'resolveHeteroSpawnCommand').mockResolvedValue({
    command: process.execPath,
  });
  // Exercise real child-process buffering without requiring an installed or authenticated CLI.
  vi.spyOn(cliSpawn, 'resolveCliSpawnPlan').mockResolvedValue({
    args: [
      '-e',
      `const variants = Array.from({ length: 600 }, (_, index) => ({
        label: 'Model ' + index,
        model_uid: 'model-' + index,
        description: 'Model metadata '.repeat(40),
      }));
      process.stdout.write(JSON.stringify({ families: [{ variants }] }));`,
    ],
    command: process.execPath,
  });

  const result = await listHeterogeneousAgentModels({
    type: 'devin',
  });

  expect(result).toMatchObject({
    models: variants.map(({ label, model_uid }) => ({
      id: model_uid,
      label,
      modelId: model_uid,
      providerId: 'devin',
    })),
    status: 'success',
  });
});
