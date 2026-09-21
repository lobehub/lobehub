import * as childProcess from 'node:child_process';
import * as os from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  probeRemotePlatform,
  resolveRemotePlatformCommand,
  resolveRemotePlatformRuntime,
} from './scanHost';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof os>('node:os');
  return { ...actual, platform: vi.fn(() => 'darwin') };
});

const {
  detectHeterogeneousCliCommandMock,
  detectValidatedCommandCandidatesMock,
  resolveCliSpawnPlanMock,
} = vi.hoisted(() => ({
  detectHeterogeneousCliCommandMock: vi.fn(),
  detectValidatedCommandCandidatesMock: vi.fn(),
  resolveCliSpawnPlanMock: vi.fn(),
}));

vi.mock('../spawn/resolveCliCommand', () => ({
  detectHeterogeneousCliCommand: detectHeterogeneousCliCommandMock,
  detectValidatedCommandCandidates: detectValidatedCommandCandidatesMock,
}));

vi.mock('../spawn/cliSpawn', () => ({
  resolveCliSpawnPlan: resolveCliSpawnPlanMock,
}));

const platformMock = vi.mocked(os.platform);
const execFileMock = vi.mocked(childProcess.execFile);

describe('platform command scanning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platformMock.mockReturnValue('darwin');
    resolveCliSpawnPlanMock.mockImplementation(async (command, args) => ({ args, command }));
  });

  it('uses the shared PATH and Windows-shim-aware command resolver', async () => {
    detectValidatedCommandCandidatesMock.mockResolvedValue({
      available: true,
      path: '/resolved/bin/openclaw',
      resolvedPathEnv: '/resolved/bin:/usr/bin',
      version: '1.2.3',
    });

    await expect(resolveRemotePlatformCommand('openclaw')).resolves.toEqual({
      available: true,
      path: '/resolved/bin/openclaw',
      resolvedPathEnv: '/resolved/bin:/usr/bin',
      version: '1.2.3',
    });
    expect(detectValidatedCommandCandidatesMock).toHaveBeenCalledWith(
      [
        'openclaw',
        path.join(os.homedir(), '.openclaw', 'bin', 'openclaw'),
        path.join(os.homedir(), '.local', 'bin', 'openclaw'),
      ],
      {
        validateHelpKeywords: ['Usage: openclaw'],
        validateKeywords: ['openclaw'],
        validatePattern: expect.any(RegExp),
      },
    );
  });

  it('accepts the bare version banner printed by OpenClaw 2026.1.29', async () => {
    detectValidatedCommandCandidatesMock.mockImplementation(async (_commands, options) => ({
      available: options.validatePattern.test('2026.1.29'),
      path: '/resolved/bin/openclaw',
      version: '2026.1.29',
    }));

    await expect(resolveRemotePlatformCommand('openclaw')).resolves.toMatchObject({
      available: true,
      version: '2026.1.29',
    });
  });

  it('rejects unsupported platforms before probing any command', async () => {
    await expect(resolveRemotePlatformCommand('future-platform')).resolves.toEqual({
      available: false,
      error: 'Unknown platform: future-platform',
    });
    expect(detectValidatedCommandCandidatesMock).not.toHaveBeenCalled();
  });

  it('rejects a Windows shim that cannot produce a shell-free spawn plan', async () => {
    platformMock.mockReturnValue('win32');
    detectValidatedCommandCandidatesMock.mockResolvedValue({
      available: true,
      path: String.raw`C:\Users\x\AppData\Roaming\npm\openclaw.cmd`,
      version: '2026.1.29',
    });

    await expect(resolveRemotePlatformCommand('openclaw')).resolves.toEqual({
      available: false,
      error: 'openclaw was not found or failed validation',
    });
  });

  it('falls back to the official OpenClaw managed install path', async () => {
    detectValidatedCommandCandidatesMock.mockResolvedValue({
      available: true,
      path: path.join(os.homedir(), '.openclaw', 'bin', 'openclaw'),
      version: '2026.1.29',
    });

    await expect(resolveRemotePlatformCommand('openclaw')).resolves.toMatchObject({
      available: true,
      version: '2026.1.29',
    });
    expect(detectValidatedCommandCandidatesMock.mock.calls[0]![0]).toContain(
      path.join(os.homedir(), '.openclaw', 'bin', 'openclaw'),
    );
  });

  it('falls back to the official Hermes user-local install path', async () => {
    detectValidatedCommandCandidatesMock.mockResolvedValue({
      available: true,
      path: path.join(os.homedir(), '.local', 'bin', 'hermes'),
      version: '0.20.5',
    });

    await expect(resolveRemotePlatformCommand('hermes')).resolves.toMatchObject({
      available: true,
      version: '0.20.5',
    });
    expect(detectValidatedCommandCandidatesMock.mock.calls[0]![0]).toEqual([
      'hermes',
      path.join(os.homedir(), '.local', 'bin', 'hermes'),
    ]);
  });

  it('keeps host scan responses free of executable paths', async () => {
    detectValidatedCommandCandidatesMock.mockResolvedValue({
      available: true,
      path: '/private/bin/hermes',
      resolvedPathEnv: '/private/bin:/usr/bin',
      version: '0.9.0',
    });

    await expect(probeRemotePlatform('hermes')).resolves.toEqual({
      available: true,
      version: '0.9.0',
    });
  });

  it('binds spawn preparation to the validated executable and recovered PATH', async () => {
    detectValidatedCommandCandidatesMock.mockResolvedValue({
      available: true,
      path: '/resolved/bin/openclaw',
      resolvedPathEnv: '/runtime/bin:/usr/bin',
      version: '2026.1.29',
    });
    const baseEnv: NodeJS.ProcessEnv = {
      ...process.env,
      AUTH_TOKEN: 'token',
      PATH: '/stale/bin:/usr/bin',
    };

    const runtime = await resolveRemotePlatformRuntime('openclaw', baseEnv);
    expect(runtime.available).toBe(true);
    if (!runtime.available) return;

    await expect(runtime.prepareSpawn(['agent', '--local'])).resolves.toEqual({
      args: ['agent', '--local'],
      command: '/resolved/bin/openclaw',
      env: expect.objectContaining({
        AUTH_TOKEN: 'token',
        PATH: '/runtime/bin:/usr/bin',
      }),
    });
    expect(resolveCliSpawnPlanMock).toHaveBeenCalledWith(
      '/resolved/bin/openclaw',
      ['agent', '--local'],
      expect.objectContaining({
        AUTH_TOKEN: 'token',
        PATH: '/runtime/bin:/usr/bin',
      }),
    );
  });

  it('executes one-shot commands through the prepared runtime plan', async () => {
    detectValidatedCommandCandidatesMock.mockResolvedValue({
      available: true,
      path: '/resolved/bin/hermes',
      resolvedPathEnv: '/runtime/bin:/usr/bin',
    });
    resolveCliSpawnPlanMock.mockImplementation(async (command, args) =>
      args.length === 0
        ? { args, command }
        : { args: ['/runtime/hermes.js', ...args], command: '/runtime/node' },
    );
    execFileMock.mockImplementationOnce(((
      _command: string,
      _args: string[],
      _options: object,
      callback: (error: null, stdout: string, stderr: string) => void,
    ) => {
      callback(null, '◆default\n', 'diagnostic\n');
      return {};
    }) as never);

    const runtime = await resolveRemotePlatformRuntime('hermes');
    expect(runtime.available).toBe(true);
    if (!runtime.available) return;

    await expect(runtime.execute(['profile', 'list'], { timeout: 1234 })).resolves.toEqual({
      stderr: 'diagnostic\n',
      stdout: '◆default\n',
    });
    expect(execFileMock).toHaveBeenCalledWith(
      '/runtime/node',
      ['/runtime/hermes.js', 'profile', 'list'],
      expect.objectContaining({
        env: expect.objectContaining({ PATH: '/runtime/bin:/usr/bin' }),
        timeout: 1234,
      }),
      expect.any(Function),
    );
  });

  it('surfaces the platform validation failure reason', async () => {
    detectValidatedCommandCandidatesMock.mockResolvedValue({ available: false });

    await expect(probeRemotePlatform('hermes')).resolves.toEqual({
      available: false,
      reason: 'hermes was not found or failed validation',
    });
  });
});
