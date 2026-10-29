import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { describe, expect, it } from 'vitest';

import { AskUserBridge } from '../askUser/AskUserBridge';
import { isHeterogeneousAgentAuthRequired } from '../config';
import { AcpRpcResponseError } from './acpStdioClient';
import {
  buildCopilotAcpArgs,
  buildCopilotAcpPrompt,
  isCopilotAcpSessionNotFoundError,
} from './copilotAcpSession';
import { spawnAgent } from './spawnAgent';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__/copilotAcp');

/**
 * A stand-in `copilot --acp`: answers the ACP lifecycle from the recorded
 * 1.0.105 handshake and, on `session/prompt`, replays a recorded turn —
 * including its `session/request_permission` requests, each held until the
 * client answers. Every frame it receives is logged for assertions.
 */
const FAKE_COPILOT = `
const fs = require('node:fs');
const env = process.env;
const log = (frame) => fs.appendFileSync(env.FAKE_LOG, JSON.stringify({ argv: process.argv.slice(2), frame }) + '\\n');
const write = (frame) => process.stdout.write(JSON.stringify(frame) + '\\n');
const send = (frame) => write({ jsonrpc: '2.0', ...frame });
const handshake = JSON.parse(fs.readFileSync(env.FAKE_HANDSHAKE, 'utf8'));
const answers = new Map();
let cancel;
const cancelled = new Promise((resolve) => { cancel = resolve; });

const replay = async (file, sessionId) => {
  for (const line of fs.readFileSync(file, 'utf8').trim().split('\\n')) {
    const frame = JSON.parse(line.split('{{sessionId}}').join(sessionId));
    if (frame.method === 'session/request_permission') {
      const answered = new Promise((resolve) => answers.set(frame.id, resolve));
      write(frame);
      await answered;
    } else {
      write(frame);
    }
  }
};

const handle = async ({ id, method, params }) => {
  if (method === 'initialize') {
    const result = JSON.parse(JSON.stringify(handshake.initialize.result));
    if (env.FAKE_PROTOCOL) result.protocolVersion = Number(env.FAKE_PROTOCOL);
    if (env.FAKE_NO_LOAD) result.agentCapabilities.loadSession = false;
    return send({ id, result });
  }
  if (method === 'session/new') {
    if (env.FAKE_AUTH_REQUIRED) return send({ id, error: handshake.sessionNewWithoutAuth.error });
    const result = { ...handshake.sessionNew.result, sessionId: 'copilot-new' };
    if (env.FAKE_MODEL_CONFIG) result.configOptions = [...result.configOptions, JSON.parse(env.FAKE_MODEL_CONFIG)];
    return send({ id, result });
  }
  if (method === 'session/load') {
    if (params.sessionId === 'copilot-gone') {
      return send({ id, error: { code: -32002, message: 'Resource not found: Session copilot-gone not found', data: { uri: 'Session copilot-gone not found' } } });
    }
    await replay(env.FAKE_LOAD_FIXTURE, params.sessionId);
    return send({ id, result: JSON.parse(env.FAKE_LOAD_RESULT) });
  }
  if (method === 'session/set_model') return send({ id, result: {} });
  if (method === 'session/set_config_option') return send({ id, result: { configOptions: handshake.sessionNew.result.configOptions } });
  if (method === 'session/cancel') return cancel();
  if (method === 'session/prompt') {
    await replay(env.FAKE_FIXTURE, params.sessionId);
    if (env.FAKE_WAIT_CANCEL) await cancelled;
    return send({ id, result: JSON.parse(env.FAKE_RESULT) });
  }
};

let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  const lines = buffer.split('\\n');
  buffer = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    const frame = JSON.parse(line);
    log(frame);
    if (frame.method) void handle(frame);
    else answers.get(frame.id)?.(frame);
  }
});
`;

const scenarios = async () =>
  JSON.parse(await readFile(path.join(FIXTURES, 'scenarios.json'), 'utf8')).scenarios as Record<
    string,
    { result: Record<string, unknown> }
  >;

interface StartOptions {
  allowAll?: boolean;
  askUserBridge?: AskUserBridge;
  env?: Record<string, string>;
  extraArgs?: string[];
  fixture: string;
  /** Rewrite the recorded turn before replaying it. */
  frames?: (lines: string[]) => string[];
  initialModel?: string;
  resumeSessionId?: string;
}

const start = async ({ env = {}, fixture, frames, ...options }: StartOptions) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'copilot-acp-'));
  const logPath = path.join(dir, 'requests.jsonl');
  const command = path.join(dir, 'copilot');
  await writeFile(command, `#!${process.execPath}\n${FAKE_COPILOT}`);
  await chmod(command, 0o755);
  let fixturePath = path.join(FIXTURES, `${fixture}.jsonl`);
  if (frames) {
    const lines = (await readFile(fixturePath, 'utf8')).trim().split('\n');
    fixturePath = path.join(dir, `${fixture}.jsonl`);
    await writeFile(fixturePath, `${frames(lines).join('\n')}\n`);
  }
  const { [fixture]: scenario, 'acp-load-replay': load } = await scenarios();

  const handle = await spawnAgent({
    ...options,
    agentType: 'copilot',
    command,
    cwd: dir,
    env: {
      FAKE_FIXTURE: fixturePath,
      FAKE_HANDSHAKE: path.join(FIXTURES, 'handshake.json'),
      FAKE_LOAD_FIXTURE: path.join(FIXTURES, 'acp-load-replay.jsonl'),
      FAKE_LOAD_RESULT: JSON.stringify(load!.result),
      FAKE_LOG: logPath,
      FAKE_RESULT: JSON.stringify(scenario?.result ?? { stopReason: 'end_turn' }),
      ...env,
    },
    operationId: 'op-copilot',
    prompt: 'Read notes.txt, then run the probe command.',
  });
  const requests = async () =>
    (await readFile(logPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { argv: string[]; frame: any });
  return { dir, handle, requests };
};

const collect = async (
  handle: Awaited<ReturnType<typeof spawnAgent>>,
  onEvent?: (event: AgentStreamEvent) => void,
) => {
  const events: AgentStreamEvent[] = [];
  for await (const event of handle.events) {
    events.push(event);
    onEvent?.(event);
  }
  await handle.exit;
  return events;
};

/** Answer every permission the bridge raises with the given option id. */
const answerPermissions = (bridge: AskUserBridge, optionId: string) => {
  const raised: any[] = [];
  void (async () => {
    for await (const event of bridge.events()) {
      if (event.type !== 'agent_intervention_request') continue;
      const data = event.data as any;
      raised.push(data);
      const [{ question }] = JSON.parse(data.arguments).questions;
      bridge.resolve(data.toolCallId, { result: { [question]: optionId } });
    }
  })();
  return raised;
};

const methodsOf = (requests: { frame: any }[]) =>
  requests.map(({ frame }) => frame.method ?? `response:${frame.id}`);

const permissionAnswers = (requests: { frame: any }[]) =>
  requests.filter(({ frame }) => !frame.method).map(({ frame }) => frame.result);

const text = (events: AgentStreamEvent[]) =>
  events
    .filter((e) => e.type === 'stream_chunk' && (e.data as any).chunkType === 'text')
    .map((e) => (e.data as any).content)
    .join('');

const withoutPermissionRequests = (lines: string[]) =>
  lines.filter((line) => !line.includes('"session/request_permission"'));

describe('GitHub Copilot ACP session', () => {
  it('handshakes, opens a session and asks LobeHub before a shell command', async () => {
    const bridge = new AskUserBridge('op-copilot', {
      identifier: 'claude-code',
      provider: 'copilot',
    });
    const raised = answerPermissions(bridge, 'allow_once');
    const { handle, requests } = await start({
      askUserBridge: bridge,
      extraArgs: ['--add-dir', '/repo'],
      fixture: 'acp-github-tool-turn',
    });
    const events = await collect(handle);
    const log = await requests();

    expect(log[0]!.argv).toEqual(['--acp', '--add-dir', '/repo']);
    expect(log[0]!.frame).toMatchObject({
      method: 'initialize',
      params: {
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: 'lobehub' },
        protocolVersion: 1,
      },
    });
    expect(methodsOf(log)).toEqual(['initialize', 'session/new', 'session/prompt', 'response:0']);
    expect(log[1]!.frame.params).toEqual({ cwd: expect.any(String), mcpServers: [] });
    expect(handle.sessionId).toBe('copilot-new');

    expect(raised).toEqual([
      expect.objectContaining({
        identifier: 'claude-code',
        interactionKind: 'permission',
        provider: 'copilot',
        toolCallId: 'copilot-permission-0-call_WR3KchaI4SAyaV9mzjaorzFD',
      }),
    ]);
    expect(JSON.parse(raised[0].arguments).questions[0]).toMatchObject({
      options: [
        { id: 'allow_once', label: 'Allow once' },
        { id: 'allow_always', label: 'Always allow' },
        { id: 'reject_once', label: 'Deny' },
      ],
      question: 'Run requested shell command\n\necho copilot-acp-probe && uname -s',
    });
    expect(permissionAnswers(log)).toEqual([
      { outcome: { optionId: 'allow_once', outcome: 'selected' } },
    ]);

    // The permission card and both Copilot tools each keep one stable id.
    const starts = events
      .filter((e) => e.type === 'tool_start')
      .map((e) => (e.data as any).toolCallId);
    expect(starts).toEqual([
      'call_Mmv92wCSvmVcwD9b0dwiuzb3',
      'call_WR3KchaI4SAyaV9mzjaorzFD',
      'copilot-permission-0-call_WR3KchaI4SAyaV9mzjaorzFD',
    ]);
    expect(events.filter((e) => e.type === 'tool_result')).toHaveLength(3);
    expect(text(events)).toContain('copilot-acp-probe\nLinux');
    expect(events.at(-1)).toMatchObject({
      data: { stopReason: 'end_turn' },
      operationId: 'op-copilot',
      type: 'agent_runtime_end',
    });
  });

  it('runs tools without a bridge round-trip when Copilot does not ask (#845)', async () => {
    const bridge = new AskUserBridge('op-copilot', {
      identifier: 'claude-code',
      provider: 'copilot',
    });
    const raised = answerPermissions(bridge, 'allow_once');
    const { handle, requests } = await start({
      askUserBridge: bridge,
      fixture: 'acp-github-tool-turn',
      frames: withoutPermissionRequests,
    });
    const events = await collect(handle);

    expect(raised).toEqual([]);
    expect(permissionAnswers(await requests())).toEqual([]);
    expect(
      events.filter((e) => e.type === 'tool_result').map((e) => (e.data as any).isError),
    ).toEqual([false, false]);
  });

  it('denies a shell command when nobody can answer, ending just that tool', async () => {
    const { handle, requests } = await start({ fixture: 'acp-permission-reject' });
    const events = await collect(handle);

    expect(permissionAnswers(await requests())).toEqual([
      { outcome: { optionId: 'reject_once', outcome: 'selected' } },
    ]);
    expect(events.find((e) => e.type === 'tool_result' && (e.data as any).isError)?.data).toEqual({
      content: 'The user rejected this tool call.',
      isError: true,
      toolCallId: 'call_mock_10',
    });
  });

  it('turns on allow_all for unattended runs and approves stragglers', async () => {
    const { handle, requests } = await start({
      allowAll: true,
      fixture: 'acp-byok-openai-tool-turn',
    });
    await collect(handle);
    const log = await requests();

    expect(methodsOf(log)).toEqual([
      'initialize',
      'session/new',
      'session/set_config_option',
      'session/prompt',
      'response:0',
    ]);
    expect(log[2]!.frame.params).toEqual({
      configId: 'allow_all',
      sessionId: 'copilot-new',
      value: 'on',
    });
    expect(permissionAnswers(log)).toEqual([
      { outcome: { optionId: 'allow_once', outcome: 'selected' } },
    ]);
  });

  it('cancels a running tool and closes it, since Copilot sends no terminal update', async () => {
    const { handle, requests } = await start({
      allowAll: true,
      env: { FAKE_WAIT_CANCEL: '1' },
      fixture: 'acp-cancel-during-tool',
    });
    const events = await collect(handle, (event) => {
      if (event.type === 'tool_start') handle.kill('SIGINT');
    });

    expect(methodsOf(await requests())).toContain('session/cancel');
    expect(events.filter((e) => e.type === 'tool_result').map((e) => e.data)).toEqual([
      { content: 'Cancelled before the tool finished.', isError: true, toolCallId: 'call_mock_7' },
    ]);
    expect(events.at(-1)).toMatchObject({
      data: { reason: 'interrupted', stopReason: 'cancelled' },
      type: 'agent_runtime_end',
    });
    await expect(handle.exit).resolves.toEqual({ code: null, signal: 'SIGINT' });
  });

  it('answers a pending permission as cancelled when the turn is cancelled', async () => {
    const bridge = new AskUserBridge('op-copilot', {
      identifier: 'claude-code',
      provider: 'copilot',
    });
    const { handle, requests } = await start({
      askUserBridge: bridge,
      env: { FAKE_WAIT_CANCEL: '1' },
      fixture: 'acp-cancel-at-permission',
    });
    void (async () => {
      for await (const event of bridge.events()) {
        if (event.type === 'agent_intervention_request') handle.kill('SIGINT');
      }
    })();
    const events = await collect(handle);
    const log = await requests();

    expect(methodsOf(log)).toEqual(expect.arrayContaining(['session/cancel', 'response:0']));
    expect(permissionAnswers(log)).toEqual([{ outcome: { outcome: 'cancelled' } }]);
    expect(events.filter((e) => e.type === 'tool_result').map((e) => e.data)).toEqual([
      expect.objectContaining({ toolCallId: 'copilot-permission-0-call_mock_8' }),
      { content: 'Cancelled before the tool finished.', isError: true, toolCallId: 'call_mock_8' },
    ]);
    expect(events.at(-1)).toMatchObject({ data: { reason: 'interrupted' } });
  });

  it('resumes with session/load without re-rendering the replayed history', async () => {
    const { handle, requests } = await start({
      allowAll: true,
      fixture: 'acp-byok-openai-tool-turn',
      resumeSessionId: 'copilot-old',
    });
    const events = await collect(handle);
    const log = await requests();

    expect(log[1]!.frame).toMatchObject({
      method: 'session/load',
      params: { mcpServers: [], sessionId: 'copilot-old' },
    });
    expect(handle.sessionId).toBe('copilot-old');
    // Replayed history (call_mock_20/21 and its text) never reaches the new turn.
    expect(
      events.filter((e) => e.type === 'tool_start').map((e) => (e.data as any).toolCallId),
    ).toEqual(['call_mock_0', 'call_mock_1']);
    expect(text(events).split('Reading notes.txt first.')).toHaveLength(2);
  });

  it('surfaces a missing saved session as a recognizable load error', async () => {
    const { handle } = await start({
      fixture: 'acp-byok-openai-tool-turn',
      resumeSessionId: 'copilot-gone',
    });
    const events = await collect(handle);

    expect(events.at(-1)).toMatchObject({
      data: {
        message: expect.stringContaining('Resource not found: Session copilot-gone not found'),
      },
      type: 'error',
    });
    expect(
      isCopilotAcpSessionNotFoundError(
        new AcpRpcResponseError('session/load', {
          code: -32_002,
          message: 'Resource not found: Session copilot-gone not found',
        }),
      ),
    ).toBe(true);
    expect(
      isCopilotAcpSessionNotFoundError(
        new AcpRpcResponseError('session/new', { code: -32_002, message: 'Session x not found' }),
      ),
    ).toBe(false);
  });

  it('switches to the requested model with session/set_model', async () => {
    const { handle, requests } = await start({
      allowAll: true,
      fixture: 'acp-byok-openai-tool-turn',
      initialModel: 'claude-haiku-4.5',
    });
    const events = await collect(handle);

    expect((await requests())[3]!.frame).toMatchObject({
      method: 'session/set_model',
      params: { modelId: 'claude-haiku-4.5', sessionId: 'copilot-new' },
    });
    expect(events.find((e) => e.type === 'stream_start')?.data).toMatchObject({
      model: 'claude-haiku-4.5',
    });
  });

  it('keeps Copilot’s own model for the default selection', async () => {
    const { handle, requests } = await start({ fixture: 'acp-plan', initialModel: 'default' });
    await collect(handle);

    expect(methodsOf(await requests())).toEqual(['initialize', 'session/new', 'session/prompt']);
  });

  it('prefers an advertised model option and rejects models it does not offer', async () => {
    const modelConfig = JSON.stringify({
      category: 'model',
      currentValue: 'auto',
      id: 'model',
      options: [
        { name: 'Auto', value: 'auto' },
        { name: 'GPT-6 Luna', value: 'gpt-6-luna' },
      ],
      type: 'select',
    });
    const offered = await start({
      env: { FAKE_MODEL_CONFIG: modelConfig },
      fixture: 'acp-plan',
      initialModel: 'gpt-6-luna',
    });
    await collect(offered.handle);
    expect((await offered.requests())[2]!.frame).toMatchObject({
      method: 'session/set_config_option',
      params: { configId: 'model', value: 'gpt-6-luna' },
    });

    const missing = await start({
      env: { FAKE_MODEL_CONFIG: modelConfig },
      fixture: 'acp-plan',
      initialModel: 'claude-opus-5.5',
    });
    const events = await collect(missing.handle);
    expect(events.at(-1)).toMatchObject({
      data: { message: 'GitHub Copilot ACP model is unavailable: claude-opus-5.5' },
      type: 'error',
    });
    expect(methodsOf(await missing.requests())).not.toContain('session/prompt');
  });

  it('reports a missing GitHub login as an auth-required error', async () => {
    const { handle } = await start({
      env: { FAKE_AUTH_REQUIRED: '1' },
      fixture: 'acp-plan',
    });
    const events = await collect(handle);
    const error = events.at(-1)!;

    expect(error).toMatchObject({
      data: { message: expect.stringContaining('Authentication required') },
      type: 'error',
    });
    expect(isHeterogeneousAgentAuthRequired('copilot', (error.data as any).message)).toBe(true);
  });

  it('refuses an ACP protocol version it does not speak', async () => {
    const { handle, requests } = await start({ env: { FAKE_PROTOCOL: '2' }, fixture: 'acp-plan' });
    const events = await collect(handle);

    expect(events.at(-1)).toMatchObject({
      data: { message: 'GitHub Copilot ACP returned unsupported protocol version: 2' },
      type: 'error',
    });
    expect(methodsOf(await requests())).toEqual(['initialize']);
  });
});

describe('GitHub Copilot ACP helpers', () => {
  it.each([
    ['--yolo'],
    ['--allow-all-tools'],
    ['--allow-all'],
    ['--autopilot'],
    ['--resume=abc'],
    ['-p'],
    ['--acp'],
  ])('rejects %s, which bypasses LobeHub permissions or the ACP lifecycle', (argument) => {
    expect(() => buildCopilotAcpArgs([argument])).toThrow(
      `GitHub Copilot ACP does not support CLI argument: ${argument}`,
    );
  });

  it('passes ordinary flags through after --acp', () => {
    expect(
      buildCopilotAcpArgs(['--add-dir', '/repo', '--allow-tool=shell(git:*)', '--model', 'auto']),
    ).toEqual(['--acp', '--add-dir', '/repo', '--allow-tool=shell(git:*)', '--model', 'auto']);
  });

  it('refuses to spawn with a reserved argument', async () => {
    await expect(
      spawnAgent({
        agentType: 'copilot',
        command: '/nonexistent/copilot',
        cwd: tmpdir(),
        extraArgs: ['--yolo'],
        operationId: 'op-copilot',
        prompt: 'hi',
      }),
    ).rejects.toThrow('GitHub Copilot ACP does not support CLI argument: --yolo');
  });

  it('sends images as ACP image blocks', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    await expect(
      buildCopilotAcpPrompt([
        { text: 'What is this?', type: 'text' },
        {
          source: { data: png.toString('base64'), mediaType: 'image/png', type: 'base64' },
          type: 'image',
        },
      ]),
    ).resolves.toEqual([
      { text: 'What is this?', type: 'text' },
      { data: png.toString('base64'), mimeType: 'image/png', type: 'image' },
    ]);
  });
});
