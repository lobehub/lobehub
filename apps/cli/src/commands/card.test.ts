import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import { parseCardFile, registerCardCommand } from './card';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    channel: {
      cardGuide: { query: vi.fn() },
      renderCard: { mutate: vi.fn() },
    },
  },
}));
const { getTrpcClient: mockGetTrpcClient } = vi.hoisted(() => ({ getTrpcClient: vi.fn() }));
vi.mock('../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));

const operations = [
  { createSurface: { surfaceId: 'weekly' }, version: '1.0' },
  {
    updateComponents: {
      components: [{ component: 'Card', id: 'root' }],
      surfaceId: 'weekly',
    },
    version: '1.0',
  },
];

describe('card command', () => {
  let dir: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'lh-card-'));
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(log, 'error').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    mockTrpcClient.channel.cardGuide.query.mockReset();
    mockTrpcClient.channel.renderCard.mutate.mockReset();
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    errorSpy.mockRestore();
  });

  const run = (...args: string[]) => {
    const program = new Command();
    program.exitOverride();
    registerCardCommand(program);
    return program.parseAsync(['node', 'test', 'card', ...args]);
  };

  const cardFile = (content: string) => {
    const file = path.join(dir, 'card.json');
    writeFileSync(file, content);
    return file;
  };

  describe('parseCardFile', () => {
    it('reads the operations array, or renderUI arguments that wrap it', () => {
      expect(parseCardFile(JSON.stringify(operations))).toEqual(operations);
      expect(parseCardFile(JSON.stringify({ operations }))).toEqual(operations);
    });

    it('refuses a file that is not JSON', () => {
      expect(() => parseCardFile('{nope')).toThrow('The card file is not valid JSON');
    });
  });

  it('prints the guide the server serves', async () => {
    mockTrpcClient.channel.cardGuide.query.mockResolvedValue({ guide: '<a2ui_guide>…' });
    await run('guide');
    expect(consoleSpy).toHaveBeenCalledWith('<a2ui_guide>…');
  });

  it('sends the file’s messages for the current run and reports the drawn card', async () => {
    mockTrpcClient.channel.renderCard.mutate.mockResolvedValue({
      message: 'Card "weekly" drawn; it is posted with your reply.',
      ok: true,
      replaced: false,
      surfaceId: 'weekly',
    });
    await run('render', '--file', cardFile(JSON.stringify(operations)), '--json');

    expect(mockTrpcClient.channel.renderCard.mutate).toHaveBeenCalledWith({ operations });
    expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toMatchObject({
      ok: true,
      surfaceId: 'weekly',
    });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('reads the card from stdin with --file -', async () => {
    mockTrpcClient.channel.renderCard.mutate.mockResolvedValue({
      message: 'drawn',
      ok: true,
      replaced: true,
      surfaceId: 'weekly',
    });
    const stdin = Object.getOwnPropertyDescriptor(process, 'stdin')!;
    Object.defineProperty(process, 'stdin', {
      configurable: true,
      value: Readable.from([Buffer.from(JSON.stringify({ operations }))]),
    });
    try {
      await run('render', '--file', '-');
    } finally {
      Object.defineProperty(process, 'stdin', stdin);
    }
    expect(mockTrpcClient.channel.renderCard.mutate).toHaveBeenCalledWith({ operations });
    expect(consoleSpy.mock.calls[0][0]).toContain('drawn');
  });

  it('prints the errors of an invalid card and exits non-zero so the agent fixes it', async () => {
    mockTrpcClient.channel.renderCard.mutate.mockResolvedValue({
      errors: ['root must be a Card'],
      message: 'The card was not drawn. Fix these and call renderUI again:\n- root must be a Card',
      ok: false,
    });
    await expect(run('render', '--file', cardFile(JSON.stringify(operations)))).rejects.toThrow(
      'exit:1',
    );
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('root must be a Card'));
  });

  it('fails before calling the server on an unreadable or malformed file', async () => {
    await expect(run('render', '--file', path.join(dir, 'missing.json'))).rejects.toThrow('exit:1');
    await expect(run('render', '--file', cardFile('not json'))).rejects.toThrow('exit:1');
    expect(mockTrpcClient.channel.renderCard.mutate).not.toHaveBeenCalled();
  });
});
