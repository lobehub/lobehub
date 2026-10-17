import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ClaudeAgentSdkSession,
  resolveClaudeSdkExecutablePath,
  spawnClaudeCodeCliProcess,
} from './claudeAgentSdkSession';
import { resolveClaudeCodeTranscriptPath } from './ensureResumeTranscript';

const resolveCliSpawnPlanMock = vi.hoisted(() => vi.fn());
const spawnMock = vi.hoisted(() => vi.fn());
const sdkQueryMock = vi.hoisted(() => vi.fn());

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: sdkQueryMock }));

vi.mock('./cliSpawn', () => ({ resolveCliSpawnPlan: resolveCliSpawnPlanMock }));
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  spawn: spawnMock,
}));

describe('resolveClaudeSdkExecutablePath', () => {
  beforeEach(() => {
    resolveCliSpawnPlanMock.mockReset();
  });

  it.each(['C:\\Users\\user\\AppData\\Roaming\\npm\\claude.cmd', 'C:\\tools\\claude.BAT'])(
    'unwraps a Windows Node shim for the Agent SDK: %s',
    async (commandPath) => {
      const scriptPath =
        'C:\\Users\\user\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js';
      resolveCliSpawnPlanMock.mockResolvedValue({
        args: [scriptPath],
        command: 'C:\\Program Files\\nodejs\\node.exe',
      });

      await expect(resolveClaudeSdkExecutablePath(commandPath, process.env, 'win32')).resolves.toBe(
        scriptPath,
      );
      expect(resolveCliSpawnPlanMock).toHaveBeenCalledWith(commandPath, [], process.env);
    },
  );

  it('uses a native executable targeted by a Windows shim', async () => {
    const commandPath = 'C:\\tools\\claude.cmd';
    const executablePath = 'C:\\tools\\claude.exe';
    resolveCliSpawnPlanMock.mockResolvedValue({ args: [], command: executablePath });

    await expect(resolveClaudeSdkExecutablePath(commandPath, process.env, 'win32')).resolves.toBe(
      executablePath,
    );
  });

  it('reports an unresolved Windows shim before the SDK tries to spawn it', async () => {
    const commandPath = 'C:\\tools\\claude.cmd';
    resolveCliSpawnPlanMock.mockResolvedValue({ args: [], command: commandPath });

    await expect(resolveClaudeSdkExecutablePath(commandPath, process.env, 'win32')).rejects.toThrow(
      'Unable to resolve the Claude Code Windows shim',
    );
  });

  it('keeps a native Windows executable', async () => {
    const commandPath = 'C:\\tools\\claude.exe';

    await expect(resolveClaudeSdkExecutablePath(commandPath, process.env, 'win32')).resolves.toBe(
      commandPath,
    );
    expect(resolveCliSpawnPlanMock).not.toHaveBeenCalled();
  });

  it('keeps the detected executable on other platforms', async () => {
    const commandPath = '/opt/homebrew/bin/claude';

    await expect(resolveClaudeSdkExecutablePath(commandPath, process.env, 'darwin')).resolves.toBe(
      commandPath,
    );
    expect(resolveCliSpawnPlanMock).not.toHaveBeenCalled();
  });
});

describe('spawnClaudeCodeCliProcess', () => {
  const spawnOptions = {
    args: ['--output-format', 'stream-json'],
    command: '/usr/local/bin/claude',
    cwd: '/repo',
    env: { PATH: '/usr/bin' },
    signal: new AbortController().signal,
  };

  const fakeChild = () => {
    const child = new EventEmitter() as any;
    child.pid = 4321;
    child.stderr = new EventEmitter();
    return child;
  };

  beforeEach(() => {
    spawnMock.mockReset();
  });

  it('reports the CLI child so a crashed host can reap it', () => {
    // The SDK runs a real Claude executable; without its identity, an orphan
    // left by a hard crash is still writing the transcript recovery replays.
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const onProcessSpawn = vi.fn();

    spawnClaudeCodeCliProcess(spawnOptions as any, { onProcessSpawn, onStderr: vi.fn() }, 'darwin');

    expect(onProcessSpawn).toHaveBeenCalledWith({
      args: ['/usr/local/bin/claude', '--output-format', 'stream-json'],
      command: '/usr/local/bin/claude',
      pid: 4321,
    });
    // Its own Unix process group, so reaping takes the tool children with it.
    expect(spawnMock.mock.calls[0][2]).toMatchObject({ cwd: '/repo', detached: true });
  });

  it('keeps the child out of a process group on Windows', () => {
    spawnMock.mockReturnValue(fakeChild());

    spawnClaudeCodeCliProcess(spawnOptions as any, { onStderr: vi.fn() }, 'win32');

    expect(spawnMock.mock.calls[0][2]).toMatchObject({ detached: false });
  });

  it('drains stderr the SDK no longer reads', () => {
    // The SDK only wires its own stderr option on the spawn it owns; an
    // unread pipe fills up and blocks the CLI.
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const onStderr = vi.fn();

    spawnClaudeCodeCliProcess(spawnOptions as any, { onStderr }, 'darwin');
    child.stderr.emit('data', Buffer.from('boom'));

    expect(onStderr).toHaveBeenCalledWith('boom');
  });
});

describe('ClaudeAgentSdkSession resume cost', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    sdkQueryMock.mockReset();
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
  });

  it('emits a resumed run its own cost, using the profile dir the CLI resumes from', async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), 'lobe-sdk-profile-'));
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'lobe-sdk-cwd-'));
    tempDirs.push(configDir, cwd);
    const sessionId = '72f65fa9-0355-45d3-b903-8f41027ed5f2';
    const transcript = (await resolveClaudeCodeTranscriptPath({ configDir, cwd, sessionId }))!;
    await mkdir(path.dirname(transcript), { recursive: true });
    await writeFile(
      transcript,
      `${JSON.stringify({ sessionId, totalCostUSD: 69.67, type: 'cost-state' })}\n`,
    );

    const messages = [
      { model: 'claude-sonnet-4-6', session_id: sessionId, subtype: 'init', type: 'system' },
      {
        is_error: false,
        result: 'done',
        session_id: sessionId,
        subtype: 'success',
        total_cost_usd: 76.43,
        type: 'result',
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    ];
    sdkQueryMock.mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        yield* messages;
      },
      close: vi.fn(),
    }));

    const events: any[] = [];
    const session = new ClaudeAgentSdkSession({
      args: [],
      commandPath: 'claude',
      configDir,
      cwd,
      env: {} as NodeJS.ProcessEnv,
      onEvents: (batch) => {
        events.push(...batch);
      },
      onRawMessage: () => {},
      onRuntimeStatus: () => {},
      onSessionId: () => {},
      onStderr: () => {},
      operationId: 'op-sdk-resume',
      resumeSessionId: sessionId,
      sessionId: 'session-1',
      stdinPayload: `${JSON.stringify({
        message: { content: 'continue', role: 'user' },
        type: 'user',
      })}\n`,
    });
    await session.run();

    const resultUsage = events.find(
      (e) => e.type === 'step_complete' && e.data?.phase === 'result_usage',
    );
    expect(resultUsage?.data.costUsd).toBeCloseTo(6.76);
  });
});
