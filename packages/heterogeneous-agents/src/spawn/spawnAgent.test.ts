import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnCalls: Array<{ args: string[]; command: string; options: any }> = [];
let nextFakeProc: any = null;

vi.mock('node:child_process', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    spawn: (command: string, args: string[], options: any) => {
      spawnCalls.push({ args, command, options });
      return nextFakeProc;
    },
  };
});

const createFakeProc = ({
  exitCode = 0,
  stdoutChunks = [] as string[],
  stderrChunks = [] as string[],
}: {
  exitCode?: number;
  stderrChunks?: string[];
  stdoutChunks?: string[];
} = {}) => {
  const proc = new EventEmitter() as any;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdinWrites: string[] = [];
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.stdin = {
    end: vi.fn(),
    write: vi.fn((chunk: string, cb?: () => void) => {
      stdinWrites.push(chunk);
      cb?.();
      return true;
    }),
  };
  proc.kill = vi.fn();
  proc.killed = false;
  proc.pid = 12_345;

  const start = () => {
    setImmediate(() => {
      for (const c of stdoutChunks) stdout.write(c);
      for (const c of stderrChunks) stderr.write(c);
      stdout.end();
      stderr.end();
      proc.emit('exit', exitCode, null);
    });
  };

  return { proc, start, stdinWrites };
};

const ccInit = `${JSON.stringify({
  model: 'claude-sonnet-4-6',
  session_id: 'cc-1',
  subtype: 'init',
  type: 'system',
})}\n`;

const ccText = `${JSON.stringify({
  message: {
    content: [{ text: 'hello', type: 'text' }],
    id: 'msg_01',
    model: 'claude-sonnet-4-6',
    role: 'assistant',
  },
  type: 'assistant',
})}\n`;

describe('spawnAgent', () => {
  beforeEach(() => {
    spawnCalls.length = 0;
    nextFakeProc = null;
  });

  afterEach(() => {
    nextFakeProc = null;
  });

  it('spawns claude with stream-json flags + writes prompt as user message to stdin', async () => {
    const fake = createFakeProc({ stdoutChunks: [ccInit] });
    nextFakeProc = fake.proc;

    const { spawnAgent } = await import('./spawnAgent');
    const handle = await spawnAgent({
      agentType: 'claude-code',
      operationId: 'op-1',
      prompt: 'do a thing',
    });
    fake.start();

    const events: any[] = [];
    for await (const event of handle.events) events.push(event);
    await handle.exit;

    expect(spawnCalls).toHaveLength(1);
    const call = spawnCalls[0];
    expect(call.command).toBe('claude');
    expect(call.args).toContain('--input-format');
    expect(call.args).toContain('--output-format');
    expect(call.args.filter((a) => a === 'stream-json')).toHaveLength(2);
    expect(call.args).toContain('-p');
    // CC's built-in interactive Q&A is disabled at every spawn site so the
    // model degrades to plain-text questioning instead of stalling on a
    // synthetic "Answer questions?" tool_result.
    const disallowedIdx = call.args.indexOf('--disallowedTools');
    expect(disallowedIdx).toBeGreaterThan(-1);
    expect(call.args[disallowedIdx + 1]).toBe('AskUserQuestion');
    // Partial deltas are opt-in — terminal/sandbox callers want fewer events.
    expect(call.args).not.toContain('--include-partial-messages');
    // Prompt MUST go through stdin as a stream-json user message — never as argv.
    expect(call.args).not.toContain('do a thing');
    expect(fake.stdinWrites).toHaveLength(1);
    const userMsg = JSON.parse(fake.stdinWrites[0].trim());
    expect(userMsg).toMatchObject({
      message: { content: [{ text: 'do a thing', type: 'text' }], role: 'user' },
      type: 'user',
    });
    // Events flow through the pipeline (session id extracted by adapter).
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) expect(event.operationId).toBe('op-1');
  });

  it('passes --include-partial-messages only when includePartialMessages=true', async () => {
    nextFakeProc = createFakeProc().proc;
    const { spawnAgent } = await import('./spawnAgent');
    await spawnAgent({
      agentType: 'claude-code',
      includePartialMessages: true,
      operationId: 'op-1',
      prompt: 'do a thing',
    });
    expect(spawnCalls[0].args).toContain('--include-partial-messages');
  });

  it('appends --resume <id> for claude when resuming a session', async () => {
    nextFakeProc = createFakeProc().proc;
    const { spawnAgent } = await import('./spawnAgent');
    await spawnAgent({
      agentType: 'claude-code',
      operationId: 'op-1',
      prompt: 'continue',
      resumeSessionId: 'cc-prev-123',
    });

    const { args } = spawnCalls[0];
    const resumeIdx = args.indexOf('--resume');
    expect(resumeIdx).toBeGreaterThan(-1);
    expect(args[resumeIdx + 1]).toBe('cc-prev-123');
  });

  it('builds codex args with `exec` + json + skip-git-repo-check + full-auto', async () => {
    nextFakeProc = createFakeProc().proc;
    const { spawnAgent } = await import('./spawnAgent');
    await spawnAgent({ agentType: 'codex', operationId: 'op-1', prompt: 'hello' });

    const { args, command } = spawnCalls[0];
    expect(command).toBe('codex');
    expect(args[0]).toBe('exec');
    expect(args).toContain('--json');
    expect(args).toContain('--skip-git-repo-check');
    expect(args).toContain('--full-auto');
  });

  it('uses codex `exec resume` form with thread id + `-` stdin marker on resume', async () => {
    nextFakeProc = createFakeProc().proc;
    const { spawnAgent } = await import('./spawnAgent');
    await spawnAgent({
      agentType: 'codex',
      operationId: 'op-1',
      prompt: 'continue',
      resumeSessionId: 'thread_abc',
    });

    const { args } = spawnCalls[0];
    expect(args.slice(0, 2)).toEqual(['exec', 'resume']);
    expect(args).toContain('thread_abc');
    expect(args.at(-1)).toBe('-');
  });

  it('serializes multimodal content blocks into the CC stream-json user message', async () => {
    nextFakeProc = createFakeProc().proc;
    const { spawnAgent } = await import('./spawnAgent');
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    await spawnAgent({
      agentType: 'claude-code',
      operationId: 'op-1',
      prompt: [
        { text: 'describe this', type: 'text' },
        {
          source: { data: pngBytes.toString('base64'), mediaType: 'image/png', type: 'base64' },
          type: 'image',
        },
      ],
    });

    // The mock's fake stdin captures everything written.
    const stdinPayload = (nextFakeProc as any).stdin.write.mock.calls[0][0] as string;
    const userMsg = JSON.parse(stdinPayload.trim());
    expect(userMsg.message.content).toEqual([
      { text: 'describe this', type: 'text' },
      {
        source: {
          data: pngBytes.toString('base64'),
          media_type: 'image/png',
          type: 'base64',
        },
        type: 'image',
      },
    ]);
  });

  it('renders codex multimodal input as text-on-stdin + repeatable --image flags', async () => {
    nextFakeProc = createFakeProc().proc;
    const os = await import('node:os');
    const fsp = await import('node:fs/promises');
    const cacheDir = await fsp.mkdtemp(`${os.tmpdir()}/spawn-agent-codex-`);

    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const { spawnAgent } = await import('./spawnAgent');
    await spawnAgent({
      agentType: 'codex',
      inputOptions: { cacheDir },
      operationId: 'op-1',
      prompt: [
        { text: 'look', type: 'text' },
        {
          source: { data: pngBytes.toString('base64'), mediaType: 'image/png', type: 'base64' },
          type: 'image',
        },
      ],
    });

    const { args } = spawnCalls[0];
    const imageIdx = args.indexOf('--image');
    expect(imageIdx).toBeGreaterThan(-1);
    const materializedPath = args[imageIdx + 1]!;
    expect(materializedPath.startsWith(cacheDir)).toBe(true);
    expect(materializedPath.endsWith('.png')).toBe(true);
    // Codex receives the prompt text on stdin.
    const stdinPayload = (nextFakeProc as any).stdin.write.mock.calls[0][0] as string;
    expect(stdinPayload).toBe('look');
  });

  it('honors a custom --command override + extraArgs', async () => {
    nextFakeProc = createFakeProc().proc;
    const { spawnAgent } = await import('./spawnAgent');
    await spawnAgent({
      agentType: 'claude-code',
      command: '/usr/local/bin/claude-wrapped',
      extraArgs: ['--my-flag', 'x'],
      operationId: 'op-1',
      prompt: 'hi',
    });

    const { args, command } = spawnCalls[0];
    expect(command).toBe('/usr/local/bin/claude-wrapped');
    expect(args).toContain('--my-flag');
    expect(args).toContain('x');
  });

  it('rejects with an error on unknown agent type', async () => {
    nextFakeProc = createFakeProc().proc;
    const { spawnAgent } = await import('./spawnAgent');
    await expect(
      spawnAgent({ agentType: 'kimi-cli', operationId: 'op-1', prompt: 'hi' }),
    ).rejects.toThrow(/unsupported agent type/);
  });

  it('events iterator drains all pipeline events including the trailing flush', async () => {
    const fake = createFakeProc({ stdoutChunks: [ccInit, ccText] });
    nextFakeProc = fake.proc;

    const { spawnAgent } = await import('./spawnAgent');
    const handle = await spawnAgent({
      agentType: 'claude-code',
      operationId: 'op-7',
      prompt: 'go',
    });
    fake.start();

    const events: any[] = [];
    for await (const event of handle.events) events.push(event);

    // At minimum we expect a stream_start (from CC init) and a stream_chunk
    // (from the assistant text). The exact event count depends on adapter
    // partials; we just assert non-empty + every event carries our op id.
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) expect(event.operationId).toBe('op-7');

    // Verify the iterator actually completed (no hang).
    const exit = await handle.exit;
    expect(exit.code).toBe(0);
  });

  /**
   * Regression for the "out-of-order events when push() is async" bug.
   * `AgentStreamPipeline.push` is async (Codex tracker awaits FS), so
   * back-to-back stdout chunks would otherwise have their `then` handlers
   * race. Spy on `push` to make chunk #1 resolve AFTER chunk #2 — the spawn
   * helper must serialize the work so events still come out in source order.
   */
  it('preserves event ordering across async pipeline.push() calls (Codex tracker race)', async () => {
    vi.resetModules();

    const { AgentStreamPipeline: RealPipeline } = await import('./agentStreamPipeline');
    const pipelineSpy = vi.spyOn(RealPipeline.prototype, 'push').mockImplementation(function (
      this: any,
      chunk: Buffer | string,
    ) {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const tag = text.trim();
      // Earlier-arriving chunk gets a longer delay than later-arriving one,
      // so without the queue chain the later chunk's `then` handler fires
      // first and the events come out reversed.
      const delay = tag === 'A' ? 30 : 0;
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve([
            {
              data: { tag },
              operationId: this.operationId,
              stepIndex: 0,
              timestamp: 0,
              type: 'stream_chunk' as const,
            },
          ]);
        }, delay);
      });
    });
    vi.spyOn(RealPipeline.prototype, 'flush').mockResolvedValue([]);

    const fake = createFakeProc();
    nextFakeProc = fake.proc;
    const { spawnAgent } = await import('./spawnAgent');
    const handle = await spawnAgent({
      agentType: 'claude-code',
      operationId: 'op-1',
      prompt: 'go',
    });

    // Fire two chunks back-to-back BEFORE 'end'. Both `pipeline.push()` calls
    // are now in flight; without serialization, B's events would queue first.
    setImmediate(() => {
      (fake.proc.stdout as PassThrough).write('A');
      (fake.proc.stdout as PassThrough).write('B');
      // Give the queue chain time to drain before ending.
      setTimeout(() => {
        (fake.proc.stdout as PassThrough).end();
        fake.proc.emit('exit', 0, null);
      }, 60);
    });

    const collected: any[] = [];
    for await (const event of handle.events) collected.push(event.data.tag);

    expect(collected).toEqual(['A', 'B']);
    pipelineSpy.mockRestore();
  });

  /**
   * Regression for the "iterator returns done before late push events queue"
   * bug. Force `push()` to be slow + `end` to fire while it's still pending.
   * Without the queue chain, `flush()` would set `streamEnded = true` before
   * the slow push's events landed in the queue.
   */
  it('iterator drains slow in-flight pushes before flushing the stream', async () => {
    vi.resetModules();

    const { AgentStreamPipeline: RealPipeline } = await import('./agentStreamPipeline');
    vi.spyOn(RealPipeline.prototype, 'push').mockImplementation(function (this: any) {
      // 40ms delay simulates the codex tracker's FS reads.
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve([
            {
              data: {},
              operationId: this.operationId,
              stepIndex: 0,
              timestamp: 0,
              type: 'stream_chunk' as const,
            },
          ]);
        }, 40);
      });
    });
    vi.spyOn(RealPipeline.prototype, 'flush').mockResolvedValue([]);

    const fake = createFakeProc();
    nextFakeProc = fake.proc;
    const { spawnAgent } = await import('./spawnAgent');
    const handle = await spawnAgent({
      agentType: 'claude-code',
      operationId: 'op-1',
      prompt: 'go',
    });

    // 'end' fires immediately after the chunk write — pipeline.push() is still
    // pending. The fix must keep the iterator open until that push resolves.
    setImmediate(() => {
      (fake.proc.stdout as PassThrough).write('chunk');
      (fake.proc.stdout as PassThrough).end();
      fake.proc.emit('exit', 0, null);
    });

    const collected: any[] = [];
    for await (const event of handle.events) collected.push(event);

    expect(collected).toHaveLength(1);
  });

  it('events iterator surfaces a stream error instead of hanging', async () => {
    const fake = createFakeProc();
    nextFakeProc = fake.proc;

    const { spawnAgent } = await import('./spawnAgent');
    const handle = await spawnAgent({
      agentType: 'claude-code',
      operationId: 'op-1',
      prompt: 'go',
    });

    // Fire an error on stdout instead of letting it end naturally.
    setImmediate(() => {
      (fake.proc.stdout as PassThrough).destroy(new Error('boom'));
      fake.proc.emit('exit', 1, null);
    });

    await expect(async () => {
      for await (const _e of handle.events) {
        // drain
      }
    }).rejects.toThrow(/boom/);
  });
});
