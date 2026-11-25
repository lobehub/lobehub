import type * as NodeFs from 'node:fs';

import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerAgentSpaceFsCommand } from './spaceFs';

const { mockFstatSync, mockReadStdinText, mockTrpcClient } = vi.hoisted(() => ({
  mockFstatSync: vi.fn(),
  mockReadStdinText: vi.fn(),
  mockTrpcClient: {
    agentDocument: {
      statDocumentByPath: { query: vi.fn() },
      writeDocumentByPath: { mutate: vi.fn() },
    },
  },
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>();
  return { ...actual, fstatSync: mockFstatSync };
});
vi.mock('node:stream/consumers', () => ({ text: mockReadStdinText }));
vi.mock('../../api/client', () => ({ getTrpcClient: async () => mockTrpcClient }));

const run = (...args: string[]) => {
  const program = new Command();
  program.exitOverride();
  registerAgentSpaceFsCommand(program.command('agent'));
  return program.parseAsync(['node', 'test', 'agent', 'space', 'fs', ...args]);
};

const stdinOf = (kind: 'fifo' | 'file' | 'null') => ({
  isFIFO: () => kind === 'fifo',
  isFile: () => kind === 'file',
});

describe('agent space fs content from stdin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mockTrpcClient.agentDocument.statDocumentByPath.query.mockRejectedValue({
      data: { code: 'NOT_FOUND' },
    });
    mockTrpcClient.agentDocument.writeDocumentByPath.mutate.mockResolvedValue({
      path: './notes/a.md',
    });
  });

  // Node leaves `isTTY` undefined for a pipe, so only fstat can tell one apart.
  it.each(['fifo', 'file'] as const)(
    'reads %s stdin when no content option is given',
    async (kind) => {
      mockFstatSync.mockReturnValue(stdinOf(kind));
      mockReadStdinText.mockResolvedValue('# Piped Content');

      await run('write', '--agent-id', 'a1', 'agent:/notes/a.md');

      expect(mockFstatSync).toHaveBeenCalledWith(0);
      expect(mockReadStdinText).toHaveBeenCalledWith(process.stdin);
      expect(mockTrpcClient.agentDocument.writeDocumentByPath.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'a1', content: '# Piped Content' }),
      );
    },
  );

  it('does not wait on stdin bound to /dev/null, as in an agent shell', async () => {
    mockFstatSync.mockReturnValue(stdinOf('null'));

    await run('touch', '--agent-id', 'a1', 'agent:/notes/a.md');

    expect(mockReadStdinText).not.toHaveBeenCalled();
    expect(mockTrpcClient.agentDocument.writeDocumentByPath.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ content: '' }),
    );
  });

  it('prefers --content over piped stdin', async () => {
    mockFstatSync.mockReturnValue(stdinOf('fifo'));

    await run('write', '--agent-id', 'a1', '--content', 'inline', 'agent:/notes/a.md');

    expect(mockReadStdinText).not.toHaveBeenCalled();
    expect(mockTrpcClient.agentDocument.writeDocumentByPath.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'inline' }),
    );
  });
});
