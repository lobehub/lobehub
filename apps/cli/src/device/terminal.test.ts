import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TerminalSessionManager } from './terminal';

interface FakePty {
  emitData: (data: string) => void;
  emitExit: (exitCode: number) => void;
  kill: ReturnType<typeof vi.fn>;
  pid: number;
  resize: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
}

const ptys: FakePty[] = [];
let spawnOptions: Record<string, unknown> | undefined;

vi.mock('@lydell/node-pty', () => ({
  spawn: (_shell: string, _args: string[], options: Record<string, unknown>) => {
    spawnOptions = options;
    let dataHandler: ((data: string) => void) | undefined;
    let exitHandler: ((event: { exitCode: number }) => void) | undefined;
    const pty: FakePty = {
      emitData: (data) => dataHandler?.(data),
      emitExit: (exitCode) => exitHandler?.({ exitCode }),
      kill: vi.fn(),
      pid: 4000 + ptys.length,
      resize: vi.fn(),
      write: vi.fn(),
    };
    ptys.push(pty);
    return {
      ...pty,
      onData: (cb: (data: string) => void) => {
        dataHandler = cb;
      },
      onExit: (cb: (event: { exitCode: number }) => void) => {
        exitHandler = cb;
      },
    };
  },
}));

const decode = (base64: string) => Buffer.from(base64, 'base64').toString('utf8');

describe('TerminalSessionManager', () => {
  let manager: TerminalSessionManager;

  beforeEach(() => {
    ptys.length = 0;
    spawnOptions = undefined;
    manager = new TerminalSessionManager();
  });

  afterEach(() => {
    manager.dispose();
  });

  const openSession = async () => {
    const info = await manager.create({ cols: 80, rows: 24 });
    return { info, pty: ptys.at(-1)! };
  };

  it('spawns a PTY with xterm capabilities instead of a piped child', async () => {
    // The whole point of a pty: `sudo` reads its password from /dev/tty, which
    // only exists when the shell has a controlling terminal.
    const { info } = await openSession();

    expect(info).toMatchObject({ shell: expect.any(String), pid: expect.any(Number) });
    expect(spawnOptions).toMatchObject({
      cols: 80,
      env: expect.objectContaining({ TERM: 'xterm-256color' }),
      name: 'xterm-256color',
      rows: 24,
    });
  });

  it('returns only output produced after the caller cursor', async () => {
    const { info, pty } = await openSession();

    pty.emitData('first');
    const first = manager.read({ cursor: 0, id: info.id });
    expect(decode(first.chunk)).toBe('first');
    expect(first).toMatchObject({ exited: false, nextCursor: 5 });

    // Nothing new yet.
    expect(manager.read({ cursor: first.nextCursor, id: info.id }).chunk).toBe('');

    pty.emitData('second');
    const second = manager.read({ cursor: first.nextCursor, id: info.id });
    expect(decode(second.chunk)).toBe('second');
    expect(second.nextCursor).toBe(11);
  });

  it('writes the caller bytes straight through to the PTY', async () => {
    const { info, pty } = await openSession();
    const keystrokes = Buffer.from('TituPass123!\n', 'utf8').toString('base64');

    manager.write({ data: keystrokes, id: info.id });

    const written = pty.write.mock.calls[0][0];
    expect(Buffer.isBuffer(written)).toBe(true);
    expect(written.toString('utf8')).toBe('TituPass123!\n');
  });

  it('keeps a shell that exited readable so its last output is not swallowed', async () => {
    const { info, pty } = await openSession();

    pty.emitData('bye\n');
    pty.emitExit(3);

    const result = manager.read({ cursor: 0, id: info.id });
    expect(decode(result.chunk)).toBe('bye\n');
    expect(result).toMatchObject({ exitCode: 3, exited: true });

    // The buffer survives the exit, so a later read still reports the status.
    expect(manager.read({ cursor: 0, id: info.id }).exited).toBe(true);
    // ...but writing to a dead shell is an error, not a silent no-op.
    expect(() => manager.write({ data: '', id: info.id })).toThrow(/has exited/);
  });

  it('clamps a reader that fell behind rather than refusing to read', async () => {
    const { info, pty } = await openSession();

    // Overflow the ring buffer, so the marker at the very front is dropped.
    pty.emitData(`HEAD${'x'.repeat(1_000_000)}`);
    pty.emitData('TAIL');

    const first = manager.read({ cursor: 0, id: info.id });
    const firstText = decode(first.chunk);

    // The read resumes at the oldest output still held: 8 characters were
    // dropped ('HEAD' plus the tail of the 'x' run), so the marker never comes
    // back, and the call stops at the per-read cap rather than the buffer end.
    expect(firstText).not.toContain('HEAD');
    expect(first.nextCursor).toBe(8 + 131_072);

    // Draining to the end reaches the newest output and a stable cursor.
    let cursor = first.nextCursor;
    let text = firstText;
    for (;;) {
      const next = manager.read({ cursor, id: info.id });
      if (!next.chunk) break;
      cursor = next.nextCursor;
      text += decode(next.chunk);
    }
    expect(cursor).toBe(1_000_008);
    expect(text.endsWith('TAIL')).toBe(true);
  });

  it('caps one read so a burst is drained by repeated calls', async () => {
    const { info, pty } = await openSession();

    pty.emitData('a'.repeat(300_000));
    const first = manager.read({ cursor: 0, id: info.id });

    // 128Ki characters per call, so the next read continues where this stopped.
    expect(first.nextCursor).toBe(131_072);
    expect(manager.read({ cursor: first.nextCursor, id: info.id }).chunk).not.toBe('');
  });

  it('kills the shell on close and reports an unknown session honestly', async () => {
    const { info, pty } = await openSession();

    expect(manager.close({ id: info.id })).toEqual({ closed: true });
    expect(pty.kill).toHaveBeenCalledOnce();
    expect(manager.close({ id: info.id })).toEqual({ closed: false });
  });

  it('answers a read for a session it no longer holds as an ended shell', async () => {
    const warn = vi.fn();
    const reaped = new TerminalSessionManager({ logger: { warn } });
    try {
      const info = await reaped.create({ cols: 80, rows: 24 });
      reaped.close({ id: info.id });

      // A client polling an id this host no longer holds — daemon restarted, or
      // the LRU cap evicted it — must not read as a transport failure, or it
      // would retry the missing session forever. It reads as "the shell is gone".
      expect(reaped.read({ cursor: 0, id: info.id })).toEqual({
        chunk: '',
        exited: true,
        nextCursor: 0,
      });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(info.id));
      // Writing to it is still an error: that is a caller bug, not an exit.
      expect(() => reaped.write({ data: '', id: info.id })).toThrow(/Unknown terminal session/);
    } finally {
      reaped.dispose();
    }
  });

  it('forwards resize and ignores degenerate dimensions', async () => {
    const { info, pty } = await openSession();

    manager.resize({ cols: 120, id: info.id, rows: 40 });
    expect(pty.resize).toHaveBeenCalledWith(120, 40);

    manager.resize({ cols: 0, id: info.id, rows: 0 });
    expect(pty.resize).toHaveBeenCalledOnce();
  });
});
