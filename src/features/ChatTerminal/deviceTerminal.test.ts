import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DeviceTerminalSession,
  TERMINAL_POLL_INTERVAL_MS,
  TERMINAL_RETRY_MAX_MS,
} from './deviceTerminal';

const mocks = vi.hoisted(() => ({
  closeTerminal: vi.fn(async () => ({ closed: true })),
  createTerminalSession: vi.fn(async () => ({
    cwd: '/root',
    id: 'term_1',
    pid: 4321,
    shell: '/bin/bash',
  })),
  notifyExit: vi.fn(),
  readTerminal: vi.fn(),
  resizeTerminal: vi.fn(async () => {}),
  writeTerminal: vi.fn(async () => {}),
  setSessionSink: vi.fn(),
  write: vi.fn(),
}));

vi.mock('@/services/device', () => ({
  deviceService: {
    closeTerminal: mocks.closeTerminal,
    createTerminalSession: mocks.createTerminalSession,
    readTerminal: mocks.readTerminal,
    resizeTerminal: mocks.resizeTerminal,
    writeTerminal: mocks.writeTerminal,
  },
}));

vi.mock('./xtermManager', () => ({
  xtermManager: {
    notifyExit: mocks.notifyExit,
    setSessionSink: mocks.setSessionSink,
    write: mocks.write,
  },
}));

const open = () => DeviceTerminalSession.open('dev-1', { cols: 80, rows: 24 });

describe('DeviceTerminalSession polling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('widens the delay while reads keep failing instead of hammering the device', async () => {
    mocks.readTerminal.mockRejectedValue(new Error('Device is offline'));

    await open();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.readTerminal).toHaveBeenCalledTimes(1);

    // First failure doubles the interval: 300ms is no longer enough to retry.
    await vi.advanceTimersByTimeAsync(TERMINAL_POLL_INTERVAL_MS);
    expect(mocks.readTerminal).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(TERMINAL_POLL_INTERVAL_MS);
    expect(mocks.readTerminal).toHaveBeenCalledTimes(2);

    // Second failure: 900ms of a 1200ms wait is still not enough.
    await vi.advanceTimersByTimeAsync(900);
    expect(mocks.readTerminal).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.readTerminal).toHaveBeenCalledTimes(3);

    // ...and the widening stops at the ceiling rather than growing forever.
    await vi.advanceTimersByTimeAsync(TERMINAL_RETRY_MAX_MS * 10);
    const settled = mocks.readTerminal.mock.calls.length;
    await vi.advanceTimersByTimeAsync(TERMINAL_RETRY_MAX_MS * 10);
    expect(mocks.readTerminal.mock.calls.length - settled).toBeLessThanOrEqual(20);
  });

  it('returns to the poll interval once a read succeeds again', async () => {
    mocks.readTerminal.mockRejectedValueOnce(new Error('Device is offline'));

    await open();
    await vi.advanceTimersByTimeAsync(0);
    mocks.readTerminal.mockResolvedValue({ chunk: '', exited: false, nextCursor: 0 });

    // Ride out the backed-off retry, which succeeds and resets the delay.
    await vi.advanceTimersByTimeAsync(TERMINAL_POLL_INTERVAL_MS * 2);
    const afterRecovery = mocks.readTerminal.mock.calls.length;

    await vi.advanceTimersByTimeAsync(TERMINAL_POLL_INTERVAL_MS + 1);
    expect(mocks.readTerminal.mock.calls.length).toBeGreaterThan(afterRecovery);
  });

  it('ends the session when the device answers that it is gone', async () => {
    // What `lh connect` now returns for a session it no longer holds: the
    // reader must stop polling and close the pane, not retry a dead id forever.
    mocks.readTerminal.mockResolvedValue({ chunk: '', exited: true, exitCode: 0, nextCursor: 0 });

    await open();
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.notifyExit).toHaveBeenCalledWith('term_1', 0);
    await vi.advanceTimersByTimeAsync(TERMINAL_RETRY_MAX_MS * 10);
    expect(mocks.readTerminal).toHaveBeenCalledTimes(1);
  });

  it('stops polling once disposed', async () => {
    mocks.readTerminal.mockResolvedValue({ chunk: '', exited: false, nextCursor: 0 });

    const session = await open();
    await vi.advanceTimersByTimeAsync(0);
    const before = mocks.readTerminal.mock.calls.length;

    await session.dispose();
    await vi.advanceTimersByTimeAsync(TERMINAL_RETRY_MAX_MS * 10);

    expect(mocks.closeTerminal).toHaveBeenCalledWith({ deviceId: 'dev-1', id: 'term_1' });
    expect(mocks.readTerminal.mock.calls.length).toBe(before);
  });

  it('keeps every call on the client that created the session', async () => {
    // A device can hold `lh connect` and the desktop app at once, each with its
    // own sessions; a desktop shell's calls must not drift to the CLI.
    mocks.createTerminalSession.mockResolvedValueOnce({
      client: 'desktop',
      cwd: '/root',
      id: 'term_1',
      pid: 4321,
      shell: '/bin/zsh',
    } as never);
    mocks.readTerminal.mockResolvedValue({ chunk: '', exited: false, nextCursor: 0 });

    const session = await open();
    await vi.advanceTimersByTimeAsync(0);
    session.sink.write('term_1', 'ls');
    session.sink.resize('term_1', 100, 30);
    await vi.advanceTimersByTimeAsync(0);
    await session.dispose();

    const pinned = { client: 'desktop', deviceId: 'dev-1', id: 'term_1' };
    expect(mocks.readTerminal).toHaveBeenCalledWith(expect.objectContaining(pinned));
    expect(mocks.writeTerminal).toHaveBeenCalledWith(expect.objectContaining(pinned));
    expect(mocks.resizeTerminal).toHaveBeenCalledWith(expect.objectContaining(pinned));
    expect(mocks.closeTerminal).toHaveBeenCalledWith(pinned);
  });
});
