import { x } from 'tinyexec';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { assertExternalDaemonRestart } from './restartGuard';

vi.mock('tinyexec', () => ({ x: vi.fn() }));

afterEach(() => vi.resetAllMocks());

function processTable(rows: string) {
  vi.mocked(x).mockResolvedValue({ exitCode: 0, stderr: '', stdout: rows });
}

describe('assertExternalDaemonRestart', () => {
  it('rejects a daemon-owned shell through multiple nested processes', async () => {
    processTable(`${process.pid} 222\n222 333\n333 444\n444 1\n1 0\n`);
    await expect(assertExternalDaemonRestart(444)).rejects.toThrow('own terminal or shell');
  });

  it('also rejects an ancestor running as container init', async () => {
    processTable(`${process.pid} 222\n222 1\n1 0\n`);
    await expect(assertExternalDaemonRestart(1)).rejects.toThrow('No connector was stopped');
  });

  it('permits a local or SSH caller in a different process tree', async () => {
    processTable(`${process.pid} 222\n222 1\n444 1\n1 0\n`);
    await expect(assertExternalDaemonRestart(444)).resolves.toBeUndefined();
    expect(x).toHaveBeenCalledWith(
      'ps',
      ['-axo', 'pid=,ppid='],
      expect.objectContaining({
        throwOnError: true,
        timeout: 2000,
      }),
    );
  });

  it('permits restarting a different daemon from another daemon-owned terminal', async () => {
    processTable(`${process.pid} 222\n222 333\n333 1\n444 1\n1 0\n`);
    await expect(assertExternalDaemonRestart(444)).resolves.toBeUndefined();
  });

  it.each([
    '',
    'unexpected output',
    `${process.pid} 222\n`,
    `${process.pid} 222\n222 ${process.pid}\n`,
    `${process.pid} 9007199254740992\n`,
  ])('refuses to signal when ancestry is incomplete or invalid: %s', async (rows) => {
    processTable(rows);
    await expect(assertExternalDaemonRestart(444)).rejects.toThrow('Could not verify');
  });

  it('does not leak subprocess errors or claim a restart when inspection fails', async () => {
    vi.mocked(x).mockRejectedValue(new Error('private process information'));
    await expect(assertExternalDaemonRestart(444)).rejects.toThrow(
      'No connector was stopped. Retry from a local terminal or SSH session.',
    );
  });
});
