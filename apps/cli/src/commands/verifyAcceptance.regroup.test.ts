import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Command } from 'commander';
import { afterEach, expect, it, vi } from 'vitest';

import { registerAcceptanceCommands } from './verifyAcceptance';

const { regroup, outputJson } = vi.hoisted(() => ({
  regroup: vi.fn().mockResolvedValue({ version: 2 }),
  outputJson: vi.fn(),
}));
vi.mock('../api/client', () => ({
  getTrpcClient: async () => ({ acceptance: { regroupChecks: { mutate: regroup } } }),
}));
vi.mock('../utils/format', () => ({ outputJson }));
afterEach(() => vi.clearAllMocks());

it('submits only the requested grouping and version, without starting a verification round', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'acceptance-regroup-'));
  try {
    const input = {
      expectedVersion: 1,
      groups: [{ title: 'Reassignment', checkItemIds: ['C15-stable-id'] }],
    };
    const file = path.join(dir, 'groups.json');
    await writeFile(file, JSON.stringify(input));
    const program = new Command().exitOverride();
    registerAcceptanceCommands(program);
    await program.parseAsync([
      'node',
      'lh',
      'acceptance',
      'regroup',
      'acceptance-id',
      '--file',
      file,
    ]);
    expect(regroup).toHaveBeenCalledOnce();
    expect(regroup).toHaveBeenCalledWith({ ...input, id: 'acceptance-id' });
    expect(outputJson).toHaveBeenCalledWith({ version: 2 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
