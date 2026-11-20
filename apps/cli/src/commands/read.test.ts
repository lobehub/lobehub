import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import { parseShareTopicUrl, registerReadCommand } from './read';

const { mockGetTrpcClient, mockQuery } = vi.hoisted(() => ({
  mockGetTrpcClient: vi.fn(),
  mockQuery: vi.fn(),
}));

vi.mock('../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
vi.mock('../utils/logger', () => ({
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  setVerbose: vi.fn(),
}));

describe('parseShareTopicUrl', () => {
  it.each([
    ['https://lobehub.com/share/t/Fy1SWilu', 'Fy1SWilu'],
    ['https://lobehub.com/share/t/Fy1SWilu/llm.txt', 'Fy1SWilu'],
    ['https://lobehub.com/share/t/Fy1SWilu/llm.txt?format=text', 'Fy1SWilu'],
    ['  https://www.lobehub.com/share/t/Fy1SWilu?x=1  ', 'Fy1SWilu'],
  ])('extracts the id from %s', (input, expected) => {
    expect(parseShareTopicUrl(input)).toBe(expected);
  });

  it.each(['', 'Fy1SWilu', 'https://lobehub.com/topic/abc', 'https://'])('rejects %j', (input) => {
    expect(parseShareTopicUrl(input)).toBeUndefined();
  });
});

describe('read', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue({
      share: { getSharedTopicText: { query: mockQuery } },
    });
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  const run = async (...args: string[]) => {
    const program = new Command().exitOverride();
    registerReadCommand(program);
    await program.parseAsync(['node', 'test', 'read', ...args]);
  };

  it('prints the llm.txt layout for a share URL', async () => {
    mockQuery.mockResolvedValue({ text: 'user: hi', title: 'My Topic' });

    await run('https://lobehub.com/share/t/Fy1SWilu');

    expect(mockQuery).toHaveBeenCalledWith({ shareId: 'Fy1SWilu' });
    expect(consoleSpy).toHaveBeenCalledWith('# My Topic\n\nuser: hi');
  });

  it('omits the heading when the share has no title', async () => {
    mockQuery.mockResolvedValue({ text: 'user: hi', title: null });

    await run('https://lobehub.com/share/t/Fy1SWilu');

    expect(consoleSpy).toHaveBeenCalledWith('user: hi');
  });

  it('outputs JSON with --json', async () => {
    mockQuery.mockResolvedValue({ text: 'user: hi', title: 'T' });

    await run('https://lobehub.com/share/t/Fy1SWilu', '--json');

    expect(consoleSpy).toHaveBeenCalledWith(
      JSON.stringify({ text: 'user: hi', title: 'T' }, null, 2),
    );
  });

  it('fails without calling the server for an unsupported link', async () => {
    await run('https://lobehub.com/topic/abc');

    expect(log.error).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
