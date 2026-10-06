import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTrpcClient } from '../api/client';
import { registerAcceptanceCommands } from './verifyAcceptance';

vi.mock('../api/client', () => ({ getTrpcClient: vi.fn() }));

const acceptanceId = '598ebab1-74a3-4a7f-9bcb-9bfa71c654cb';
const prUrl = 'https://github.com/lobehub/lobehub/pull/20171';
const linkPullRequest = vi.fn();
const unlinkPullRequest = vi.fn();
let output: ReturnType<typeof vi.spyOn>;

const run = async (args: string[]) => {
  const program = new Command().exitOverride().configureOutput({ writeErr: () => {} });
  registerAcceptanceCommands(program);
  await program.parseAsync(['node', 'lh', 'acceptance', ...args]);
};

beforeEach(() => {
  vi.clearAllMocks();
  output = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.mocked(getTrpcClient).mockResolvedValue({
    acceptance: {
      linkPullRequest: { mutate: linkPullRequest },
      unlinkPullRequest: { mutate: unlinkPullRequest },
    },
  } as unknown as Awaited<ReturnType<typeof getTrpcClient>>);
  linkPullRequest.mockResolvedValue({ number: 20171, repoFullName: 'lobehub/lobehub', url: prUrl });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('acceptance link-pr', () => {
  it('links a pull request to the acceptance, not to a round', async () => {
    await run(['link-pr', acceptanceId, prUrl, '--title', 'Durable waits']);

    expect(linkPullRequest).toHaveBeenCalledExactlyOnceWith({
      id: acceptanceId,
      title: 'Durable waits',
      url: prUrl,
    });
    expect(String(output.mock.calls.at(-1)?.[0])).toContain('lobehub/lobehub#20171');
  });

  it('unlinks by the URL the user has', async () => {
    await run(['link-pr', acceptanceId, `${prUrl}/files`, '--unlink']);

    expect(unlinkPullRequest).toHaveBeenCalledExactlyOnceWith({
      id: acceptanceId,
      url: `${prUrl}/files`,
    });
    expect(linkPullRequest).not.toHaveBeenCalled();
  });
});
