import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTrpcClient } from '../../api/client';
import type * as format from '../../utils/format';
import { confirm } from '../../utils/format';
import { registerAcceptanceCommands } from '.';

vi.mock('../../api/client', () => ({ getTrpcClient: vi.fn() }));
vi.mock('../../utils/format', async (importOriginal) => ({
  ...(await importOriginal<typeof format>()),
  confirm: vi.fn(),
}));

const idA = '598ebab1-74a3-4a7f-9bcb-9bfa71c654cb';
const idB = '7f1c2d3e-0000-4a7f-9bcb-9bfa71c654cc';
const remove = vi.fn();
const removeBatch = vi.fn();
const purgePreview = vi.fn();
const getBySubject = vi.fn();
let output: ReturnType<typeof vi.spyOn>;

const run = async (args: string[]) => {
  const program = new Command().exitOverride().configureOutput({ writeErr: () => {} });
  registerAcceptanceCommands(program);
  await program.parseAsync(['node', 'lh', 'acceptance', ...args]);
};

const lastLine = () => String(output.mock.calls.at(-1)?.[0]);

beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = undefined;
  output = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(getTrpcClient).mockResolvedValue({
    acceptance: {
      getBySubject: { query: getBySubject },
      purgePreview: { query: purgePreview },
      remove: { mutate: remove },
      removeBatch: { mutate: removeBatch },
    },
  } as unknown as Awaited<ReturnType<typeof getTrpcClient>>);
  remove.mockResolvedValue({ success: true });
  purgePreview.mockResolvedValue({
    bytes: 3 * 1024 * 1024,
    fileCount: 4,
    files: { images: 3, other: 0, videos: 1 },
    rounds: 2,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe('acceptance delete', () => {
  it('deletes only the shell by default, keeping rounds as reports', async () => {
    vi.mocked(confirm).mockResolvedValue(true);

    await run(['delete', idA]);

    expect(vi.mocked(confirm).mock.calls[0][0]).toContain('kept as standalone reports');
    expect(purgePreview).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledExactlyOnceWith({ id: idA, purge: false });
    expect(lastLine()).toContain('rounds kept as standalone reports');
  });

  it('does not delete when the prompt is declined', async () => {
    vi.mocked(confirm).mockResolvedValue(false);

    await run(['delete', idA]);

    expect(remove).not.toHaveBeenCalled();
    expect(lastLine()).toBe('Aborted.');
  });

  it('shows what --purge frees before removing rounds and evidence', async () => {
    vi.mocked(confirm).mockResolvedValue(true);

    await run(['delete', idA, '--purge']);

    expect(purgePreview).toHaveBeenCalledExactlyOnceWith({ ids: [idA] });
    const prompt = vi.mocked(confirm).mock.calls[0][0];
    expect(prompt).toContain('2 round(s), 4 evidence file(s)');
    expect(prompt).toContain('3.0 MB freed');
    expect(remove).toHaveBeenCalledExactlyOnceWith({ id: idA, purge: true });
  });

  it('still asks when the purge preview is unavailable', async () => {
    vi.mocked(confirm).mockResolvedValue(true);
    purgePreview.mockRejectedValue(new Error('Acceptance not found'));

    await run(['delete', idA, '--purge']);

    expect(vi.mocked(confirm).mock.calls[0][0]).toContain('cannot be undone');
    expect(remove).toHaveBeenCalledOnce();
  });

  it('resolves a subject reference and skips the prompt with --yes', async () => {
    getBySubject.mockResolvedValue({ id: idA });

    await run(['delete', 'task:T-12', '--yes']);

    expect(getBySubject).toHaveBeenCalledOnce();
    expect(confirm).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledExactlyOnceWith({ id: idA, purge: false });
  });

  it('deletes several in one batch and fails the command for ids it could not remove', async () => {
    removeBatch.mockResolvedValue({ deleted: 1, failedIds: [idB] });

    await run(['rm', idA, idB, idA, '--yes', '--json']);

    expect(removeBatch).toHaveBeenCalledExactlyOnceWith({ ids: [idA, idB], purge: false });
    expect(remove).not.toHaveBeenCalled();
    expect(JSON.parse(lastLine())).toEqual({ deleted: 1, failedIds: [idB], purged: false });
    expect(process.exitCode).toBe(1);
  });
});
