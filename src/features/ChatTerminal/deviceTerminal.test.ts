import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DeviceTerminalSession,
  TERMINAL_POLL_INTERVAL_MS,
  TERMINAL_RETRY_MAX_MS,
} from './deviceTerminal';

const mocks = vi.hoisted(() => ({
  closeOnUnload: vi.fn(async () => ({ closed: true })),
  prepareCloseTerminalOnUnload: vi.fn(),
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
    prepareCloseTerminalOnUnload: () => mocks.prepareCloseTerminalOnUnload(),
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
    mocks.prepareCloseTerminalOnUnload.mockImplementation(async () => mocks.closeOnUnload);
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

    expect(mocks.closeTerminal).toHaveBeenCalledWith(
      { deviceId: 'dev-1', id: 'term_1' },
      { scope: undefined },
    );
    expect(mocks.readTerminal.mock.calls.length).toBe(before);
  });

  it('ends the shell with a keepalive close when the page goes away', async () => {
    mocks.readTerminal.mockResolvedValue({ chunk: '', exited: false, nextCursor: 0 });

    const session = await open();
    await vi.advanceTimersByTimeAsync(0);
    const before = mocks.readTerminal.mock.calls.length;

    session.disposeOnUnload();
    // Started synchronously: a request begun after `pagehide` returns is lost.
    expect(mocks.closeOnUnload).toHaveBeenCalledWith({ deviceId: 'dev-1', id: 'term_1' });
    // A later unmount cleanup must not send a second close.
    await session.dispose();
    await vi.advanceTimersByTimeAsync(TERMINAL_RETRY_MAX_MS * 10);

    expect(mocks.closeOnUnload).toHaveBeenCalledTimes(1);
    expect(mocks.closeTerminal).not.toHaveBeenCalled();
    expect(mocks.readTerminal.mock.calls.length).toBe(before);
  });

  it('hands out the session only once its unload close is ready', async () => {
    // Regression: a page closed right after the shell opened found no closer,
    // skipped the close, and left the PTY to the idle sweep.
    let ready!: (close: typeof mocks.closeOnUnload) => void;
    mocks.prepareCloseTerminalOnUnload.mockReturnValueOnce(new Promise((r) => (ready = r)));
    mocks.readTerminal.mockResolvedValue({ chunk: '', exited: false, nextCursor: 0 });

    let session: DeviceTerminalSession | undefined;
    void open().then((opened) => (session = opened));
    await vi.advanceTimersByTimeAsync(0);
    expect(session).toBeUndefined();

    ready(mocks.closeOnUnload);
    await vi.advanceTimersByTimeAsync(0);
    session!.disposeOnUnload();
    expect(mocks.closeOnUnload).toHaveBeenCalledWith({ deviceId: 'dev-1', id: 'term_1' });
  });

  it('falls back to an ordinary close when the unload close could not be prepared', async () => {
    mocks.prepareCloseTerminalOnUnload.mockRejectedValueOnce(new Error('offline'));
    mocks.readTerminal.mockResolvedValue({ chunk: '', exited: false, nextCursor: 0 });

    const session = await open();
    session.disposeOnUnload();

    expect(mocks.closeTerminal).toHaveBeenCalledWith(
      { deviceId: 'dev-1', id: 'term_1' },
      { scope: undefined },
    );
  });

  it("routes every call through the device's own scope", async () => {
    // A personal device must stay reachable while a workspace is active.
    mocks.readTerminal.mockResolvedValue({ chunk: '', exited: false, nextCursor: 0 });

    const session = await DeviceTerminalSession.open(
      'dev-1',
      { cols: 80, rows: 24 },
      { scope: 'personal' },
    );
    await vi.advanceTimersByTimeAsync(0);
    session.sink.write('term_1', 'ls');
    session.sink.resize('term_1', 100, 30);
    await vi.advanceTimersByTimeAsync(0);
    await session.dispose();

    expect(mocks.createTerminalSession).toHaveBeenCalledWith(
      { cols: 80, deviceId: 'dev-1', rows: 24 },
      'personal',
    );
    expect(mocks.readTerminal).toHaveBeenCalledWith(expect.anything(), 'personal');
    expect(mocks.writeTerminal).toHaveBeenCalledWith(expect.anything(), 'personal');
    expect(mocks.resizeTerminal).toHaveBeenCalledWith(expect.anything(), 'personal');
    expect(mocks.closeTerminal).toHaveBeenCalledWith(expect.anything(), { scope: 'personal' });
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
    expect(mocks.readTerminal).toHaveBeenCalledWith(expect.objectContaining(pinned), undefined);
    expect(mocks.writeTerminal).toHaveBeenCalledWith(expect.objectContaining(pinned), undefined);
    expect(mocks.resizeTerminal).toHaveBeenCalledWith(expect.objectContaining(pinned), undefined);
    expect(mocks.closeTerminal).toHaveBeenCalledWith(pinned, { scope: undefined });
  });
});
