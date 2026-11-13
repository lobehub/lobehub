import { describe, expect, it, vi } from 'vitest';

import { getRemoteTerminalDeps } from './remote';

const spawn = vi.fn(() => ({
  kill: vi.fn(),
  onData: vi.fn(),
  onExit: vi.fn(),
  pid: 4242,
  resize: vi.fn(),
  write: vi.fn(),
}));
vi.mock('@lydell/node-pty', () => ({ spawn }));

describe('getRemoteTerminalDeps', () => {
  it('serves every terminal RPC from one shared session manager', async () => {
    const first = getRemoteTerminalDeps();
    const session = await first.createTerminalSession!({ cols: 80, rows: 24 });

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(session.pid).toBe(4242);

    // A second connection (e.g. a workspace share) reaches the same session.
    const second = getRemoteTerminalDeps();
    await expect(second.readTerminal!({ cursor: 0, id: session.id })).resolves.toMatchObject({
      exited: false,
    });
    await expect(second.closeTerminal!({ id: session.id })).resolves.toEqual({ closed: true });
  });
});
