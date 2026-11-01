import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { buildHeterogeneousPrompt } from '@lobechat/heterogeneous-agents/protocol';
import type * as HeteroRpc from '@lobechat/heterogeneous-agents/rpc';
import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerHeteroCommand } from './hetero';

const { createHandle, finish, ingest } = vi.hoisted(() => ({
  createHandle: vi.fn(),
  finish: vi.fn().mockResolvedValue({ ack: true }),
  ingest: vi.fn().mockResolvedValue({ ack: true }),
}));

vi.mock('@lobechat/heterogeneous-agents/rpc', async (importOriginal) => ({
  ...(await importOriginal<typeof HeteroRpc>()),
  createPiRpcAgentHandle: createHandle,
}));
vi.mock('@lobechat/heterogeneous-agents/resolveCliCommand', () => ({
  resolveHeteroSpawnCommand: async () => ({ command: 'pi' }),
}));
vi.mock('../api/client', () => ({
  getTrpcClient: async () => ({
    aiAgent: { heteroFinish: { mutate: finish }, heteroIngest: { mutate: ingest } },
  }),
}));
vi.mock('../utils/OperationTokenRenewal', () => ({
  createOperationTokenRenewal: () => ({ active: true, stop: vi.fn() }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('Pi dispatched prompt delivery', () => {
  it.each([false, true])(
    'loads a native skill without including the guide in user text (resume: %s)',
    async (resumed) => {
      const dir = await mkdtemp(path.join(tmpdir(), 'lh-pi-dispatch-'));
      const inputPath = path.join(dir, 'input.json');
      const stderr = new PassThrough();
      stderr.end();
      createHandle.mockResolvedValue({
        events: (async function* () {})(),
        exit: Promise.resolve({ code: 0, signal: null }),
        kill: vi.fn(),
        pid: undefined,
        stderr,
      });
      const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('test process exit');
      });
      vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      try {
        await writeFile(
          inputPath,
          JSON.stringify(
            buildHeterogeneousPrompt({
              isNewSession: !resumed,
              prompt: 'Read the local file',
              systemContext: 'Selected source text',
            }),
          ),
        );
        const program = new Command();
        program.exitOverride();
        registerHeteroCommand(program);
        await expect(
          program.parseAsync(
            [
              'hetero',
              'exec',
              '--type',
              'pi',
              '--input-json',
              inputPath,
              '--topic',
              'tpc_pi_dispatch',
              '--operation-id',
              'op-pi-dispatch',
              ...(resumed ? ['--resume', 'pi-native-session'] : []),
            ],
            { from: 'user' },
          ),
        ).rejects.toThrow('test process exit');

        expect(exit).toHaveBeenCalledWith(0);
        expect(createHandle).toHaveBeenCalledOnce();
        const launch = createHandle.mock.calls[0][0];
        expect(launch.args).toEqual(['--skill', expect.any(String)]);
        expect(await readFile(launch.args[1], 'utf8')).toContain('# LobeHub CLI (`lh`)');
        expect(launch.prompt).toEqual({ text: 'Selected source text\n\nRead the local file' });
        expect(launch.resumeSessionId).toBe(resumed ? 'pi-native-session' : undefined);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
});
