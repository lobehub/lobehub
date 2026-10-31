import * as childProcess from 'node:child_process';
import * as fs from 'node:fs/promises';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

vi.mock('node:fs/promises', () => ({ realpath: vi.fn(async (path: string) => path) }));

const { detectHeterogeneousCliCommandMock } = vi.hoisted(() => ({
  detectHeterogeneousCliCommandMock: vi.fn(),
}));

vi.mock('../spawn/resolveCliCommand', () => ({
  detectHeterogeneousCliCommand: detectHeterogeneousCliCommandMock,
}));

vi.mock('../spawn/cliSpawn', () => ({
  resolveCliSpawnPlan: vi.fn(async (command: string, args: string[]) => ({ args, command })),
}));

const execFileMock = vi.mocked(childProcess.execFile);
const realpathMock = vi.mocked(fs.realpath);

const NATIVE_CLAUDE = {
  available: true,
  path: '/home/user/.local/bin/claude',
  resolvedPathEnv: '/home/user/.local/bin:/usr/bin',
  version: '2.1.301',
};

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void;

/** Captures each updater spawn so a test decides when and how it exits. */
const captureSpawns = () => {
  const spawns: Array<{ args: string[]; callback: ExecFileCallback; command: string; env: any }> =
    [];
  execFileMock.mockImplementation(((
    command: string,
    args: string[],
    options: { env: any },
    callback: ExecFileCallback,
  ) => {
    spawns.push({ args, callback, command, env: options.env });
    return {} as any;
  }) as any);
  return spawns;
};

// Jobs live in module state, so every test starts from a fresh module.
const loadModule = async () => {
  vi.resetModules();
  return import('./agentCliUpdate');
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('canSelfUpdateAgentCli', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    realpathMock.mockImplementation(async (path) => path as string);
  });

  it('allows an agent with a self-updater installed outside a package manager', async () => {
    const { canSelfUpdateAgentCli } = await loadModule();

    await expect(canSelfUpdateAgentCli('claude-code', NATIVE_CLAUDE)).resolves.toBe(true);
  });

  it('refuses a Homebrew install, which only brew can upgrade', async () => {
    realpathMock.mockResolvedValue('/opt/homebrew/Caskroom/claude-code/2.1.301/claude');
    const { canSelfUpdateAgentCli } = await loadModule();

    await expect(
      canSelfUpdateAgentCli('claude-code', { ...NATIVE_CLAUDE, path: '/opt/homebrew/bin/claude' }),
    ).resolves.toBe(false);
  });

  it('refuses an agent without a self-updater, or a CLI that is not installed', async () => {
    const { canSelfUpdateAgentCli } = await loadModule();

    await expect(
      canSelfUpdateAgentCli('codex', { ...NATIVE_CLAUDE, path: '/usr/bin/codex' }),
    ).resolves.toBe(false);
    await expect(canSelfUpdateAgentCli('claude-code', { available: false })).resolves.toBe(false);
  });
});

describe('startAgentCliUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    realpathMock.mockImplementation(async (path) => path as string);
  });

  it('runs the CLI self-updater and reports the version it moved to', async () => {
    const spawns = captureSpawns();
    detectHeterogeneousCliCommandMock
      .mockResolvedValueOnce(NATIVE_CLAUDE)
      .mockResolvedValueOnce({ ...NATIVE_CLAUDE, version: '2.1.316' });
    const { getAgentCliUpdate, startAgentCliUpdate } = await loadModule();

    expect(startAgentCliUpdate('claude-code')).toMatchObject({
      agentType: 'claude-code',
      status: 'running',
    });
    await flush();

    expect(spawns).toHaveLength(1);
    expect(spawns[0].command).toBe(NATIVE_CLAUDE.path);
    expect(spawns[0].args).toEqual(['update']);
    expect(spawns[0].env.PATH).toBe(NATIVE_CLAUDE.resolvedPathEnv);
    expect(getAgentCliUpdate('claude-code')).toMatchObject({
      fromVersion: '2.1.301',
      status: 'running',
    });

    spawns[0].callback(null, 'Successfully updated', '');
    await flush();

    expect(getAgentCliUpdate('claude-code')).toMatchObject({
      finishedAt: expect.any(Number),
      fromVersion: '2.1.301',
      status: 'succeeded',
      version: '2.1.316',
    });
  });

  it('keeps one update per agent while it runs', async () => {
    const spawns = captureSpawns();
    detectHeterogeneousCliCommandMock.mockResolvedValue(NATIVE_CLAUDE);
    const { startAgentCliUpdate } = await loadModule();

    const first = startAgentCliUpdate('claude-code');
    await flush();

    expect(startAgentCliUpdate('claude-code')).toMatchObject({
      startedAt: first.startedAt,
      status: 'running',
    });
    await flush();
    expect(spawns).toHaveLength(1);
  });

  it('reports the end of the updater output when it fails', async () => {
    const spawns = captureSpawns();
    detectHeterogeneousCliCommandMock.mockResolvedValue(NATIVE_CLAUDE);
    const { getAgentCliUpdate, startAgentCliUpdate } = await loadModule();

    startAgentCliUpdate('claude-code');
    await flush();
    spawns[0].callback(new Error('Command failed'), 'Checking for updates', 'EACCES: denied');
    await flush();

    expect(getAgentCliUpdate('claude-code')).toMatchObject({
      error: 'Checking for updates\nEACCES: denied',
      status: 'failed',
    });
  });

  it('fails without spawning when the install turns out to be Homebrew-managed', async () => {
    const spawns = captureSpawns();
    realpathMock.mockResolvedValue('/opt/homebrew/Caskroom/claude-code/2.1.301/claude');
    detectHeterogeneousCliCommandMock.mockResolvedValue(NATIVE_CLAUDE);
    const { getAgentCliUpdate, startAgentCliUpdate } = await loadModule();

    startAgentCliUpdate('claude-code');
    await flush();

    expect(spawns).toHaveLength(0);
    expect(getAgentCliUpdate('claude-code')).toMatchObject({ status: 'failed' });
  });

  it('rejects an agent that cannot update itself', async () => {
    const { getAgentCliUpdate, startAgentCliUpdate } = await loadModule();

    expect(() => startAgentCliUpdate('codex')).toThrow('codex does not support remote updates');
    expect(getAgentCliUpdate('codex')).toBeNull();
  });
});
