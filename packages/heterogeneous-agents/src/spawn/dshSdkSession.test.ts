import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  resolveDshRuntimeCommand,
  resolveDshRuntimeLaunch,
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
  it('resolves the LobeHub-owned runtime entry without a DSH checkout', () => {
    const launch = resolveDshRuntimeLaunch();

    expect(launch.command).toBe(process.execPath);
    expect(launch.args.at(-1)).toMatch(/dshRuntimeEntry\.(?:js|ts)$/);
    expect(launch.args.join(' ')).not.toContain('dsh-sdk-jsonrpc-demo');
  });

  it('launches the DSH runtime with Node when the parent CLI runs under Bun', () => {
    expect(
      resolveDshRuntimeCommand({ bun: '1.3.11' } as unknown as NodeJS.ProcessVersions, '/bun'),
    ).toBe('node');
    expect(
      resolveDshRuntimeCommand(
        { bun: '1.3.11', electron: '40.0.0' } as unknown as NodeJS.ProcessVersions,
        '/Electron',
      ),
    ).toBe('/Electron');
  });

  it('boots the bundled composition and completes the JSON-RPC handshake', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'lobehub-dsh-smoke-'));
    const session = await spawnDshSdkSession({
      cwd: workspace,
      env: {
        DSH_CWD: workspace,
        DSH_SESSION_ROOT: path.join(workspace, '.sessions'),
      },
      model: 'deepseek-chat',
      provider: 'deepseek-official',
      sessionId: 'smoke',
      timeoutMs: 60_000,
    });

    await session.dispose();
  }, 60_000);

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
