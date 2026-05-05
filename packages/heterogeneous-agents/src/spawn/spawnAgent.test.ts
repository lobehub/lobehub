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
    const handle = spawnAgent({
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
    expect(call.args).toContain('--include-partial-messages');
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

  it('appends --resume <id> for claude when resuming a session', async () => {
    nextFakeProc = createFakeProc().proc;
    const { spawnAgent } = await import('./spawnAgent');
    spawnAgent({
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
    spawnAgent({ agentType: 'codex', operationId: 'op-1', prompt: 'hello' });

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
    spawnAgent({
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

  it('honors a custom --command override + extraArgs', async () => {
    nextFakeProc = createFakeProc().proc;
    const { spawnAgent } = await import('./spawnAgent');
    spawnAgent({
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

  it('throws on unknown agent type', async () => {
    nextFakeProc = createFakeProc().proc;
    const { spawnAgent } = await import('./spawnAgent');
    expect(() =>
      spawnAgent({ agentType: 'kimi-cli', operationId: 'op-1', prompt: 'hi' }),
    ).toThrowError(/unsupported agent type/);
  });

  it('events iterator drains all pipeline events including the trailing flush', async () => {
    const fake = createFakeProc({ stdoutChunks: [ccInit, ccText] });
    nextFakeProc = fake.proc;

    const { spawnAgent } = await import('./spawnAgent');
    const handle = spawnAgent({
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

  it('events iterator surfaces a stream error instead of hanging', async () => {
    const fake = createFakeProc();
    nextFakeProc = fake.proc;

    const { spawnAgent } = await import('./spawnAgent');
    const handle = spawnAgent({
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
