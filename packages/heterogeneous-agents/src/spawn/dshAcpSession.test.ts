import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { describe, expect, it, vi } from 'vitest';

import { DSH_ACP_PROFILE_ARGS, spawnDshAcpSession } from './dshAcpSession';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__/dshAcp');

const MODEL_CONFIG = [
  {
    category: 'model',
    currentValue: '["deepseek-official","deepseek-v4-flash"]',
    id: 'model',
    options: [
      {
        group: 'deepseek-official',
        name: 'DeepSeek',
        options: [
          { name: 'deepseek-v4-flash', value: '["deepseek-official","deepseek-v4-flash"]' },
          { name: 'DeepSeek-V4-Pro', value: '["deepseek-official","deepseek-v4-pro"]' },
        ],
      },
    ],
    type: 'select',
  },
];

/**
 * A stand-in `dsh --profile acp`: answers the ACP lifecycle and, on
 * `session/prompt`, replays `session/update` notifications recorded from the
 * real 0.2.0-rc.2 runtime. Every request it receives is logged for assertions.
 */
const FAKE_RUNTIME = `
const fs = require('node:fs');
const [, , profileFlag, profile] = process.argv;
const log = (frame) => fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ argv: [profileFlag, profile], frame }) + '\\n');
const send = (frame) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...frame }) + '\\n');
const config = JSON.parse(process.env.FAKE_CONFIG);
let pendingPrompt;
let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  const lines = buffer.split('\\n');
  buffer = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    const frame = JSON.parse(line);
    log(frame);
    const { id, method, params } = frame;
    if (method === 'initialize') {
      const sessionCapabilities = process.env.FAKE_NO_RESUME ? {} : { close: {}, list: {}, resume: {} };
      send({ id, result: { agentCapabilities: { sessionCapabilities }, authMethods: [], protocolVersion: 1 } });
    } else if (method === 'session/new') {
      send({ id, result: { configOptions: config, sessionId: 'dsh-new' } });
    } else if (method === 'session/resume') {
      send({ id, result: { configOptions: config } });
    } else if (method === 'session/set_config_option') {
      send({ id, result: { configOptions: config } });
    } else if (method === 'session/prompt') {
      if (process.env.FAKE_HANG) { pendingPrompt = id; continue; }
      const recorded = fs.readFileSync(process.env.FAKE_FIXTURE, 'utf8').trim().split('\\n');
      for (const update of recorded) process.stdout.write(update.split('{{sessionId}}').join(params.sessionId) + '\\n');
      send({ id, result: { stopReason: 'end_turn' } });
    } else if (method === 'session/cancel') {
      if (pendingPrompt !== undefined) send({ id: pendingPrompt, result: { stopReason: 'cancelled' } });
    }
  }
});
`;

interface RunOptions {
  env?: Record<string, string>;
  fixture?: string;
  model?: string;
  resumeSessionId?: string;
}

const start = async ({
  env = {},
  fixture = 'acp-text-turn',
  model,
  resumeSessionId,
}: RunOptions) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-acp-'));
  const logPath = path.join(dir, 'requests.jsonl');
  const command = path.join(dir, 'dsh');
  await writeFile(command, `#!${process.execPath}\n${FAKE_RUNTIME}`);
  await chmod(command, 0o755);
  const handle = spawnDshAcpSession({
    command,
    cwd: dir,
    env: {
      FAKE_CONFIG: JSON.stringify(MODEL_CONFIG),
      FAKE_FIXTURE: path.join(FIXTURES, `${fixture}.jsonl`),
      FAKE_LOG: logPath,
      ...env,
    },
    model,
    operationId: 'op-dsh',
    resumeSessionId,
  });
  return { dir, handle, logPath };
};

const collect = async (handle: ReturnType<typeof spawnDshAcpSession>, text = 'hello') => {
  const events: AgentStreamEvent[] = [];
  for await (const event of handle.prompt(text)) events.push(event);
  return events;
};

const requestsOf = async (logPath: string) =>
  (await readFile(logPath, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { argv: string[]; frame: any });

const methodsOf = async (logPath: string) =>
  (await requestsOf(logPath)).map(({ frame }) => frame.method);

const textOf = (events: AgentStreamEvent[]) =>
  events
    .filter((e) => e.type === 'stream_chunk' && (e.data as any).chunkType === 'text')
    .map((e) => (e.data as any).content)
    .join('');

describe('spawnDshAcpSession', () => {
  it('opens a new harness session on the acp profile and streams the reply', async () => {
    const { handle, logPath } = await start({});

    const events = await collect(handle, 'say it');

    const requests = await requestsOf(logPath);
    expect(requests[0].argv).toEqual([...DSH_ACP_PROFILE_ARGS]);
    expect(requests.map(({ frame }) => frame.method)).toEqual([
      'initialize',
      'session/new',
      'session/prompt',
    ]);
    expect(requests[2].frame.params).toEqual({
      prompt: [{ text: 'say it', type: 'text' }],
      sessionId: 'dsh-new',
    });
    expect(handle.sessionId).toBe('dsh-new');
    expect(textOf(events)).toBe('ACP profile OK');
    expect(events.find((e) => e.type === 'stream_start')?.data).toMatchObject({
      model: 'deepseek-v4-flash',
      provider: 'deepseek-harness',
      sessionId: 'dsh-new',
    });
    expect(events.every((e) => e.operationId === 'op-dsh')).toBe(true);
    expect(events.at(-1)?.type).toBe('agent_runtime_end');
  });

  it('pairs a tool call with its result across the two model steps it spans', async () => {
    const { handle } = await start({ fixture: 'acp-bash-tool' });

    const events = await collect(handle);

    const toolStart = events.find((e) => e.type === 'tool_start');
    expect((toolStart?.data as any).toolCalling).toMatchObject({
      apiName: 'bash',
      identifier: 'deepseek-harness',
    });
    expect(events.find((e) => e.type === 'tool_result')?.data).toMatchObject({
      content: 'dsh-acp-proof-0207\n',
      isError: false,
    });
    expect(textOf(events)).toBe('dsh-acp-proof-0207');
    expect(events.filter((e) => e.type === 'stream_start').map((e) => e.stepIndex)).toEqual([0, 1]);
  });

  it('shows a delegated subagent as its tool call and final answer', async () => {
    const { handle } = await start({ fixture: 'acp-subagent' });

    const events = await collect(handle);

    expect((events.find((e) => e.type === 'tool_start')?.data as any).toolCalling.apiName).toBe(
      'subagent',
    );
    expect(events.find((e) => e.type === 'tool_result')?.data).toMatchObject({
      content: 'child answer 42',
    });
  });

  it('continues a persisted harness session with session/resume', async () => {
    const { dir, handle, logPath } = await start({ resumeSessionId: 'dsh-prev' });

    await collect(handle);

    const requests = await requestsOf(logPath);
    expect(requests.map(({ frame }) => frame.method)).toEqual([
      'initialize',
      'session/resume',
      'session/prompt',
    ]);
    expect(requests[1].frame.params).toEqual({ cwd: dir, mcpServers: [], sessionId: 'dsh-prev' });
    expect(requests[2].frame.params.sessionId).toBe('dsh-prev');
    expect(handle.sessionId).toBe('dsh-prev');
  });

  it('refuses to resume on a runtime that cannot, instead of opening a blank session', async () => {
    const { handle, logPath } = await start({
      env: { FAKE_NO_RESUME: '1' },
      resumeSessionId: 'dsh-prev',
    });

    await expect(collect(handle)).rejects.toThrow(/cannot resume.*npm i -g @deepseek-ai\/dsh/);
    expect(await methodsOf(logPath)).toEqual(['initialize']);
  });

  it('switches to a requested model the runtime offers', async () => {
    const { handle, logPath } = await start({ model: 'deepseek-v4-pro' });

    const events = await collect(handle);

    const setConfig = (await requestsOf(logPath)).find(
      ({ frame }) => frame.method === 'session/set_config_option',
    );
    expect(setConfig?.frame.params).toEqual({
      configId: 'model',
      sessionId: 'dsh-new',
      value: '["deepseek-official","deepseek-v4-pro"]',
    });
    expect(events.find((e) => e.type === 'stream_start')?.data).toMatchObject({
      model: 'deepseek-v4-pro',
    });
  });

  it('keeps the harness default for a model it does not offer', async () => {
    const { handle, logPath } = await start({ model: 'deepseek-chat' });

    await collect(handle);

    expect(await methodsOf(logPath)).not.toContain('session/set_config_option');
  });

  it('cancels a running turn on dispose', async () => {
    const { handle, logPath } = await start({ env: { FAKE_HANG: '1' } });

    const events: AgentStreamEvent[] = [];
    const draining = (async () => {
      for await (const event of handle.prompt('long task')) events.push(event);
    })();
    await vi.waitFor(async () => expect(await methodsOf(logPath)).toContain('session/prompt'), {
      timeout: 5000,
    });

    await handle.dispose();
    await draining;

    expect(await methodsOf(logPath)).toContain('session/cancel');
    expect(events.at(-1)?.data).toMatchObject({ reason: 'interrupted' });
  });

  it('never launches the runtime when disposed before the turn starts', async () => {
    const { handle } = await start({});

    await handle.dispose();

    expect(await collect(handle)).toEqual([]);
    expect(handle.sessionId).toBeUndefined();
  });
});
