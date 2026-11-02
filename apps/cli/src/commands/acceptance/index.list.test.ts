import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTrpcClient } from '../../api/client';
import { registerAcceptanceCommands } from '.';

vi.mock('../../api/client', () => ({ getTrpcClient: vi.fn() }));
vi.mock('../../api/workspace', () => ({ resolveWorkspaceId: () => undefined }));
vi.mock('../../settings', () => ({ resolveServerUrl: () => 'https://app.lobehub.com' }));

const list = vi.fn();
let output: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  output = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.mocked(getTrpcClient).mockResolvedValue({
    acceptance: { list: { query: list } },
  } as unknown as Awaited<ReturnType<typeof getTrpcClient>>);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('acceptance list', () => {
  it('links every acceptance to its page in JSON output', async () => {
    list.mockResolvedValue([{ id: 'acc_1', requirement: 'Ship it', status: 'pending' }]);

    const program = new Command().exitOverride();
    registerAcceptanceCommands(program);
    await program.parseAsync(['node', 'lh', 'acceptance', 'list', '--json']);

    expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toEqual([
      {
        id: 'acc_1',
        requirement: 'Ship it',
        status: 'pending',
        url: 'https://app.lobehub.com/acceptance/acc_1',
      },
    ]);
  });
});
