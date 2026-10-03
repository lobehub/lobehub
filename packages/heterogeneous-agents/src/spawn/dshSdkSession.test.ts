import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  DSH_COMMAND,
  DSH_INITIALIZE_TIMEOUT_MS,
  DSH_SDK_PROFILE_ARGS,
  spawnDshSdkSession,
} from './dshSdkSession';

/**
 * A stand-in harness runtime: answers the handshake and the prompt, then
 * streams one step's worth of session-log notifications. Keeps the transport
 * and lifecycle under test without an API key or the real runtime.
 */
const FAKE_RUNTIME = `
let buffer = '';
const send = (frame) => process.stdout.write(JSON.stringify(frame) + '\\n');
const event = (type, data) => send({
  jsonrpc: '2.0',
  method: 'session.event',
  params: { event: { data, seq: 1, time: 0, type }, sessionId: 'live-1' },
});

process.stdin.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  const lines = buffer.split('\\n');
  buffer = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    const frame = JSON.parse(line);
    if (frame.method === 'initialize') {
      send({ id: frame.id, jsonrpc: '2.0', result: { serverInfo: { name: 'fake', version: '0' } } });
    } else if (frame.method === 'session/prompt') {
      send({ id: frame.id, jsonrpc: '2.0', result: { messageId: 'm1' } });
      event('step/start', { step: 1, turn: 1 });
      if (frame.params.contentBlocks[0].text === 'fail') {
        event('turn/end', { reason: { error: { code: 'AUTH', message: 'bad key' }, kind: 'error' }, turn: 1 });
        send({ jsonrpc: '2.0', method: 'session.status', params: { sessionId: 'live-1', status: 'idle' } });
        continue;
      }
      event('request/header', { header: { config: { model: 'deepseek-chat', provider: 'deepseek-official' } }, reason: 'initial' });
      event('assistant/chunk', { chunk: { index: 0, text: 'hi', type: 'text-delta' } });
      // A sibling session in the same runtime must not reach the caller.
      send({ jsonrpc: '2.0', method: 'session.event', params: { event: { data: { step: 1, turn: 1 }, seq: 1, time: 0, type: 'step/start' }, sessionId: 'other' } });
      event('assistant/message', { message: { content: [] }, step: 1, turn: 1, usage: { inputTokens: 5, outputTokens: 2 } });
      event('turn/end', { reason: { kind: 'completed' }, turn: 1 });
      send({ jsonrpc: '2.0', method: 'session.status', params: { sessionId: 'live-1', status: 'idle' } });
    } else if (frame.method === 'shutdown') {
      send({ id: frame.id, jsonrpc: '2.0', result: {} });
    }
  }
});
`;

const startFake = () =>
  spawnDshSdkSession({
    args: ['-e', FAKE_RUNTIME],
    command: process.execPath,
    cwd: process.cwd(),
    model: 'deepseek-chat',
    provider: 'deepseek-official',
    sessionId: 'live-1',
    timeoutMs: 20_000,
  });

const collect = async (handle: Awaited<ReturnType<typeof startFake>>, text: string) => {
  const events = [];
  for await (const event of handle.prompt(text)) events.push(event);
  return events;
};

describe('spawnDshSdkSession', () => {
  // The runtime is the official DSH CLI's `sdk` profile, found on PATH — no
  // LobeHub-composed harness and no bundled `@deepseek-ai/*` packages.
  it('launches the installed `dsh` CLI with its sdk profile by default', async () => {
    expect(DSH_COMMAND).toBe('dsh');
    expect(DSH_SDK_PROFILE_ARGS).toEqual(['--profile', 'sdk']);
    if (process.platform === 'win32') return;

    const dir = await mkdtemp(path.join(tmpdir(), 'lobehub-dsh-bin-'));
    const argsFile = path.join(dir, 'args');
    // A `dsh` on PATH that records its argv and answers the handshake.
    await writeFile(
      path.join(dir, 'dsh'),
      `#!${process.execPath}\nrequire('fs').writeFileSync(process.env.ARGS_FILE, JSON.stringify(process.argv.slice(2)));let b='';process.stdin.on('data',c=>{b+=c;const ls=b.split('\\n');b=ls.pop();for(const l of ls){if(!l.trim())continue;const f=JSON.parse(l);process.stdout.write(JSON.stringify({id:f.id,jsonrpc:'2.0',result:{}})+'\\n');}})\n`,
    );
    await chmod(path.join(dir, 'dsh'), 0o755);

    const session = await spawnDshSdkSession({
      cwd: process.cwd(),
      env: { ARGS_FILE: argsFile, PATH: `${dir}${path.delimiter}${process.env.PATH ?? ''}` },
      model: 'deepseek-chat',
      provider: 'deepseek-official',
      sessionId: 'live-1',
    });
    await session.dispose();

    expect(JSON.parse(await readFile(argsFile, 'utf8'))).toEqual(['--profile', 'sdk']);
  }, 20_000);

  it('explains how to install the CLI when `dsh` is missing', async () => {
    await expect(
      spawnDshSdkSession({
        command: path.join(tmpdir(), 'lobehub-no-such-dsh'),
        cwd: process.cwd(),
        model: 'deepseek-chat',
        provider: 'deepseek-official',
        sessionId: 'live-1',
      }),
    ).rejects.toThrow(/npm i -g @deepseek-ai\/dsh/);
  }, 20_000);

  it('completes the handshake and streams one turn to whole-agent idle', async () => {
    const session = await startFake();
    try {
      const events = await collect(session, 'hello');

      expect(events.map(({ type }) => type)).toEqual([
        'stream_start',
        'stream_chunk',
        'stream_end',
        'step_complete',
        'visible_output_end',
        'agent_runtime_end',
      ]);
      // The route is logged after `step/start`, so a stream opened eagerly
      // would report no model.
      expect(events[0].data).toMatchObject({ model: 'deepseek-chat' });
    } finally {
      await session.dispose();
    }
  }, 20_000);

  it('ends a failed turn on its error when the runtime goes idle', async () => {
    const session = await startFake();
    try {
      const events = await collect(session, 'fail');

      // The run ends at idle without a trailing success that would overwrite
      // the error terminal.
      expect(events.map(({ type }) => type)).toEqual([
        'stream_start',
        'error',
        'stream_end',
        'visible_output_end',
      ]);
    } finally {
      await session.dispose();
    }
  }, 20_000);

  it('binds the prompted session so a sibling session is filtered out', async () => {
    const session = await startFake();
    try {
      const events = await collect(session, 'hello');

      // The fake emits a second `step/start` for session `other`; adopting it
      // would produce an extra stream.
      expect(events.filter(({ type }) => type === 'stream_start')).toHaveLength(1);
    } finally {
      await session.dispose();
    }
  }, 20_000);

  it('rejects instead of crashing the host when the runtime command cannot spawn', async () => {
    await expect(
      spawnDshSdkSession({
        args: [],
        command: path.join(tmpdir(), 'lobehub-dsh-missing-runtime-binary'),
        cwd: process.cwd(),
        model: 'deepseek-chat',
        provider: 'deepseek-official',
        sessionId: 'live-1',
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(/failed to start/);
  }, 10_000);

  it('times out a runtime that never answers initialize', async () => {
    await expect(
      spawnDshSdkSession({
        // Reads stdin forever and never replies.
        args: ['-e', `process.stdin.on('data', () => {})`],
        command: process.execPath,
        cwd: process.cwd(),
        model: 'deepseek-chat',
        provider: 'deepseek-official',
        sessionId: 'live-1',
        timeoutMs: 300,
      }),
    ).rejects.toThrow(/did not answer initialize within 300ms/);
  }, 10_000);

  it('bounds initialize even when the caller sets no run timeout', async () => {
    // Production launch paths (desktop, CLI) pass no `timeoutMs`; a runtime
    // that boots but never answers must still fail the spawn.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const spawned = spawnDshSdkSession({
        args: ['-e', `process.stdin.on('data', () => {})`],
        command: process.execPath,
        cwd: process.cwd(),
        model: 'deepseek-chat',
        provider: 'deepseek-official',
        sessionId: 'live-1',
      });
      const settled = spawned.then(
        () => 'resolved',
        (error: Error) => error.message,
      );

      await vi.advanceTimersByTimeAsync(DSH_INITIALIZE_TIMEOUT_MS + 1);

      await expect(settled).resolves.toMatch(/did not answer initialize/);
    } finally {
      vi.useRealTimers();
    }
  }, 20_000);

  it('does not resolve dispose until a SIGTERM-ignoring runtime is gone', async () => {
    const pidFile = path.join(await mkdtemp(path.join(tmpdir(), 'lobehub-dsh-pid-')), 'pid');
    const session = await spawnDshSdkSession({
      // Answers initialize, never answers shutdown, and ignores SIGTERM — a
      // runtime whose async teardown is stuck.
      args: [
        '-e',
        `require('fs').writeFileSync(process.env.PID_FILE, String(process.pid));process.on('SIGTERM', () => {});let b='';process.stdin.on('data',c=>{b+=c;const ls=b.split('\\n');b=ls.pop();for(const l of ls){if(!l.trim())continue;const f=JSON.parse(l);if(f.method==='initialize')process.stdout.write(JSON.stringify({id:f.id,jsonrpc:'2.0',result:{}})+'\\n');}})`,
      ],
      command: process.execPath,
      cwd: process.cwd(),
      env: { PID_FILE: pidFile },
      model: 'deepseek-chat',
      provider: 'deepseek-official',
      sessionId: 'live-1',
    });
    const pid = Number(await readFile(pidFile, 'utf8'));
    expect(pid).toBeGreaterThan(0);

    await session.dispose();

    expect(() => process.kill(pid, 0)).toThrow();
  }, 20_000);

  it('streams a second prompt on the same handle to its own idle', async () => {
    const session = await startFake();
    try {
      await collect(session, 'first');
      const second = await collect(session, 'second');

      expect(second.at(-1)?.type).toBe('agent_runtime_end');
    } finally {
      await session.dispose();
    }
  }, 20_000);

  it('surfaces a runtime that dies instead of hanging on the prompt', async () => {
    const session = await spawnDshSdkSession({
      // Answers `initialize`, then exits on any later request.
      args: [
        '-e',
        `let b='';process.stdin.on('data',c=>{b+=c;const ls=b.split('\\n');b=ls.pop();for(const l of ls){if(!l.trim())continue;const f=JSON.parse(l);if(f.method==='initialize')process.stdout.write(JSON.stringify({id:f.id,jsonrpc:'2.0',result:{serverInfo:{name:'fake',version:'0'}}})+'\\n');else{process.stderr.write('boom');process.exit(3);}}})`,
      ],
      command: process.execPath,
      cwd: process.cwd(),
      model: 'deepseek-chat',
      provider: 'deepseek-official',
      sessionId: 'live-1',
      timeoutMs: 20_000,
    });

    await expect(collect(session, 'hello')).rejects.toThrow(/exited \(code 3/);
    await session.dispose();
  }, 20_000);
});
