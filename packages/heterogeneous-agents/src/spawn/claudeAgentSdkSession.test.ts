import { EventEmitter } from 'node:events';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveClaudeSdkExecutablePath, spawnClaudeCodeCliProcess } from './claudeAgentSdkSession';

const resolveCliSpawnPlanMock = vi.hoisted(() => vi.fn());
const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('./cliSpawn', () => ({ resolveCliSpawnPlan: resolveCliSpawnPlanMock }));
vi.mock('node:child_process', () => ({ spawn: spawnMock }));

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
