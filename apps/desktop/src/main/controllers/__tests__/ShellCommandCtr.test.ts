import { existsSync, rmSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import CliCtr from '../CliCtr';
import ShellCommandCtr from '../ShellCommandCtr';

const { ipcMainHandleMock } = vi.hoisted(() => ({
  ipcMainHandleMock: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcMainHandleMock,
  },
}));

// Mock child_process for the shared package
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('../CliCtr', () => ({
  default: class CliCtr {},
}));

const {
  mockCanInstallSandbox,
  mockCreateSandboxLaunchPlan,
  mockInstallDeviceSandbox,
  mockProbeSandboxCapability,
} = vi.hoisted(() => ({
  mockCanInstallSandbox: vi.fn(),
  mockCreateSandboxLaunchPlan: vi.fn(),
  mockInstallDeviceSandbox: vi.fn(),
  mockProbeSandboxCapability: vi.fn(),
}));

vi.mock('@lobechat/device-sandbox', () => ({
  canInstallSandbox: () => mockCanInstallSandbox(),
  installDeviceSandbox: () => mockInstallDeviceSandbox(),
  createLocalSandboxPolicy: (cwd: string, options?: { allowNetwork?: boolean }) => ({
    allowNetwork: options?.allowNetwork === true,
    onUnavailable: 'deny',
    writableRoots: [cwd],
    ...(options?.allowNetwork ? { allowedNetworkDomains: ['*.npmjs.org'] } : {}),
  }),
  createSandboxLaunchPlan: (...args: unknown[]) => mockCreateSandboxLaunchPlan(...args),
  probeSandboxCapability: () => mockProbeSandboxCapability(),
}));

const mockCliCtr = {
  runCliCommand: vi.fn().mockResolvedValue({ exitCode: 0, stderr: '', stdout: 'cli output\n' }),
};

const mockApp = {
  getController: vi.fn((c: unknown) => (c === CliCtr ? mockCliCtr : undefined)),
} as unknown as App;

describe('ShellCommandCtr (thin wrapper)', () => {
  let ctr: ShellCommandCtr;
  let mockSpawn: any;
  let mockChildProcess: any;
  let mockProcessOutput: string;
  let listeners: Map<string, Set<(...args: any[]) => void>>;

  const emitChildProcess = (event: string, ...args: any[]) => {
    for (const listener of listeners.get(event) ?? []) listener(...args);
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockProcessOutput = '';
    listeners = new Map();

    const childProcessModule = await import('node:child_process');
    mockSpawn = vi.mocked(childProcessModule.spawn);

    mockChildProcess = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      // ShellProcessManager registers and later removes child process listeners
      // while racing exit/error/timeout and waiting for close. Keep enough
      // EventEmitter semantics here so the test follows the real lifecycle.
      off: vi.fn((event: string, callback: (...args: any[]) => void) => {
        listeners.get(event)?.delete(callback);
        return mockChildProcess;
      }),
      on: vi.fn((event: string, callback: (...args: any[]) => void) => {
        const eventListeners = listeners.get(event) ?? new Set();
        eventListeners.add(callback);
        listeners.set(event, eventListeners);
        return mockChildProcess;
      }),
      once: vi.fn((event: string, callback: (...args: any[]) => void) => {
        const onceCallback = (...args: any[]) => {
          listeners.get(event)?.delete(onceCallback);
          callback(...args);
        };
        const eventListeners = listeners.get(event) ?? new Set();
        eventListeners.add(onceCallback);
        listeners.set(event, eventListeners);
        return mockChildProcess;
      }),
      kill: vi.fn(),
      exitCode: null,
    };

    mockSpawn.mockImplementation((_cmd: string, _args: string[], options: any) => {
      const outputFd = Array.isArray(options?.stdio) ? options.stdio[1] : undefined;
      if (typeof outputFd === 'number' && mockProcessOutput) {
        writeSync(outputFd, mockProcessOutput);
      }
      return mockChildProcess;
    });
    ctr = new ShellCommandCtr(mockApp);
  });

  it('should delegate handleRunCommand to shared runCommand', async () => {
    mockProcessOutput = 'output\n';
    setTimeout(() => {
      mockChildProcess.exitCode = 0;
      emitChildProcess('exit', 0);
      emitChildProcess('close', 0);
    }, 10);

    const result = await ctr.handleRunCommand({
      command: 'echo test',
      description: 'test',
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('output');
  });

  it('should delegate handleGetCommandOutput to processManager', async () => {
    mockProcessOutput = 'bg output\n';

    const runResult = await ctr.handleRunCommand({
      command: 'test',
      run_in_background: true,
    });

    await new Promise((r) => setTimeout(r, 20));

    const result = await ctr.handleGetCommandOutput({
      shell_id: runResult.shell_id!,
      timeout: 0,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('bg output');
  });

  it('should delegate handleKillCommand to processManager', async () => {
    mockChildProcess.on.mockImplementation(() => mockChildProcess);
    mockChildProcess.once.mockImplementation(() => mockChildProcess);
    mockChildProcess.stdout.on.mockImplementation(() => mockChildProcess.stdout);
    mockChildProcess.stderr.on.mockImplementation(() => mockChildProcess.stderr);

    const runResult = await ctr.handleRunCommand({
      command: 'test',
      run_in_background: true,
    });

    const result = await ctr.handleKillCommand({
      shell_id: runResult.shell_id!,
    });

    expect(result.success).toBe(true);
    expect(mockChildProcess.kill).toHaveBeenCalled();
  });

  it('should route lh commands to CliCtr.runCliCommand', async () => {
    const result = await ctr.handleRunCommand({
      command: 'lh status --json',
      description: 'lh status',
    });

    expect(mockCliCtr.runCliCommand).toHaveBeenCalledWith('status --json');
    expect(result.success).toBe(true);
    expect(result.output).toContain('cli output');
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('should route lobehub commands to CliCtr.runCliCommand', async () => {
    const result = await ctr.handleRunCommand({
      command: 'lobehub search test',
      description: 'lobehub search',
    });

    expect(mockCliCtr.runCliCommand).toHaveBeenCalledWith('search test');
    expect(result.success).toBe(true);
  });

  describe('local sandbox', () => {
    beforeEach(() => {
      // Default to a host with a one-click setup (Windows); the cases that care
      // about the other platforms override it.
      mockCanInstallSandbox.mockReturnValue(true);
      mockProbeSandboxCapability.mockResolvedValue({
        available: true,
        backend: 'srt',
        networkIsolation: true,
      });
      mockCreateSandboxLaunchPlan.mockResolvedValue({
        args: ['-c', 'echo test'],
        capability: { available: true, backend: 'srt', networkIsolation: true },
        cmd: '/usr/bin/sandbox-exec',
        env: {},
        release: vi.fn(),
        sandboxed: true,
      });
    });

    it('never touches the sandbox for an ordinary command', async () => {
      // The historical path must stay byte-identical for agents that never
      // opted in — including not loading the sandbox runtime at all.
      mockProcessOutput = 'output\n';
      setTimeout(() => {
        mockChildProcess.exitCode = 0;
        emitChildProcess('exit', 0);
        emitChildProcess('close', 0);
      }, 10);

      await ctr.handleRunCommand({ command: 'echo test', cwd: '/repo' });

      expect(mockProbeSandboxCapability).not.toHaveBeenCalled();
      expect(mockCreateSandboxLaunchPlan).not.toHaveBeenCalled();
    });

    it('spawns the sandbox-wrapped command when the run is sandboxed', async () => {
      mockProcessOutput = 'output\n';
      setTimeout(() => {
        mockChildProcess.exitCode = 0;
        emitChildProcess('exit', 0);
        emitChildProcess('close', 0);
      }, 10);

      await ctr.handleRunCommand({ command: 'echo test', cwd: '/repo', sandbox: true });

      expect(mockCreateSandboxLaunchPlan).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: '/repo',
          policy: expect.objectContaining({ allowNetwork: false, writableRoots: ['/repo'] }),
        }),
      );
      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/bin/sandbox-exec',
        ['-c', 'echo test'],
        expect.anything(),
      );
    });

    it('refuses a sandboxed run with no working directory to confine', async () => {
      // Falling back to process.cwd() would fence the app install directory and
      // still report success — a guarantee about the wrong place.
      const result = await ctr.handleRunCommand({ command: 'echo test', sandbox: true });

      expect(result.success).toBe(false);
      expect(result.error).toContain('working directory');
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('fails the command instead of running it unsandboxed on an unsupported host', async () => {
      mockProbeSandboxCapability.mockResolvedValue({
        available: false,
        backend: 'none',
        networkIsolation: false,
        reason: 'Sandbox Runtime does not support win32',
      });

      const result = await ctr.handleRunCommand({
        command: 'echo test',
        cwd: '/repo',
        sandbox: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Sandbox Runtime does not support win32');
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('keeps the network shut unless the run opted in', async () => {
      mockProcessOutput = 'output\n';
      setTimeout(() => {
        mockChildProcess.exitCode = 0;
        emitChildProcess('exit', 0);
        emitChildProcess('close', 0);
      }, 10);

      await ctr.handleRunCommand({ command: 'echo test', cwd: '/repo', sandbox: true });

      expect(mockCreateSandboxLaunchPlan).toHaveBeenCalledWith(
        expect.objectContaining({ policy: expect.objectContaining({ allowNetwork: false }) }),
      );
    });

    it('opens the registry allowlist when the run opted in', async () => {
      mockProcessOutput = 'output\n';
      setTimeout(() => {
        mockChildProcess.exitCode = 0;
        emitChildProcess('exit', 0);
        emitChildProcess('close', 0);
      }, 10);

      await ctr.handleRunCommand({
        command: 'npm install',
        cwd: '/repo',
        sandbox: true,
        sandboxNetwork: true,
      });

      expect(mockCreateSandboxLaunchPlan).toHaveBeenCalledWith(
        expect.objectContaining({
          policy: expect.objectContaining({
            allowNetwork: true,
            allowedNetworkDomains: ['*.npmjs.org'],
          }),
        }),
      );
    });

    it('downgrades the advertised capability once a fence fails to establish', async () => {
      // Observed on a real Windows host: dependencies check out, then the first
      // spawn is denied. Without the downgrade the picker keeps offering an
      // environment where every command fails.
      mockCreateSandboxLaunchPlan.mockRejectedValue(
        new Error('WFP egress fence could not be verified'),
      );

      expect(await ctr.getSandboxCapability()).toEqual({
        available: true,
        canInstall: false,
        reason: undefined,
      });

      const result = await ctr.handleRunCommand({
        command: 'echo test',
        cwd: '/repo',
        sandbox: true,
      });

      expect(result.success).toBe(false);
      expect(mockSpawn).not.toHaveBeenCalled();
      expect(await ctr.getSandboxCapability()).toEqual({
        available: false,
        canInstall: true,
        reason: 'WFP egress fence could not be verified',
      });
    });

    it('does not downgrade because a sandboxed command exited non-zero', async () => {
      // Only a failure to BUILD the fence says anything about the host. A
      // command failing inside a working sandbox is the command's problem.
      mockProcessOutput = 'boom\n';
      setTimeout(() => {
        mockChildProcess.exitCode = 1;
        emitChildProcess('exit', 1);
        emitChildProcess('close', 1);
      }, 10);

      await ctr.handleRunCommand({ command: 'exit 1', cwd: '/repo', sandbox: true });

      expect(await ctr.getSandboxCapability()).toEqual({
        available: true,
        canInstall: false,
        reason: undefined,
      });
    });

    it('reports the host verdict to the renderer', async () => {
      mockProbeSandboxCapability.mockResolvedValue({
        available: false,
        backend: 'none',
        networkIsolation: false,
        reason: 'bubblewrap is not installed',
      });

      expect(await ctr.getSandboxCapability()).toEqual({
        available: false,
        canInstall: true,
        reason: 'bubblewrap is not installed',
      });
    });

    describe('setup', () => {
      it('re-reads the capability after a successful install', async () => {
        // Installing the desktop app is supposed to be enough: the row goes
        // from unavailable to usable without the user touching a terminal.
        mockCanInstallSandbox.mockReturnValue(true);
        mockProbeSandboxCapability.mockResolvedValue({
          available: false,
          backend: 'none',
          networkIsolation: false,
          reason: 'Sandbox user is not provisioned',
        });
        expect(await ctr.getSandboxCapability()).toEqual({
          available: false,
          canInstall: true,
          reason: 'Sandbox user is not provisioned',
        });

        mockInstallDeviceSandbox.mockResolvedValue({ status: 'installed' });
        mockProbeSandboxCapability.mockResolvedValue({
          available: true,
          backend: 'srt',
          networkIsolation: true,
        });

        const result = await ctr.installSandbox();

        expect(result.status).toBe('installed');
        expect(result.capability.available).toBe(true);
      });

      it('clears a downgraded verdict so a fixed host can recover', async () => {
        // The downgrade is sticky for the app run; setup is the one thing that
        // must be able to lift it, or the button could never work.
        mockCanInstallSandbox.mockReturnValue(true);
        mockCreateSandboxLaunchPlan.mockRejectedValue(new Error('egress fence unverified'));
        await ctr.handleRunCommand({ command: 'echo test', cwd: '/repo', sandbox: true });
        expect((await ctr.getSandboxCapability()).available).toBe(false);

        mockInstallDeviceSandbox.mockResolvedValue({ status: 'installed' });
        mockProbeSandboxCapability.mockResolvedValue({
          available: true,
          backend: 'srt',
          networkIsolation: true,
        });

        expect((await ctr.installSandbox()).capability.available).toBe(true);
      });

      it('reports a dismissed elevation prompt as cancelled, not a failure', async () => {
        mockCanInstallSandbox.mockReturnValue(true);
        mockInstallDeviceSandbox.mockResolvedValue({ status: 'cancelled' });
        mockProbeSandboxCapability.mockResolvedValue({
          available: false,
          backend: 'none',
          networkIsolation: false,
          reason: 'Sandbox user is not provisioned',
        });

        const result = await ctr.installSandbox();

        expect(result.status).toBe('cancelled');
        expect(result.error).toBeUndefined();
        expect(result.capability.available).toBe(false);
      });

      it('surfaces an install failure without leaving the capability stale', async () => {
        mockCanInstallSandbox.mockReturnValue(true);
        mockInstallDeviceSandbox.mockRejectedValue(new Error('WFP filter install failed'));
        mockProbeSandboxCapability.mockResolvedValue({
          available: false,
          backend: 'none',
          networkIsolation: false,
          reason: 'Sandbox user is not provisioned',
        });

        const result = await ctr.installSandbox();

        expect(result.status).toBe('failed');
        expect(result.error).toBe('WFP filter install failed');
        expect(result.capability.available).toBe(false);
      });

      it('carries manual instructions when the app cannot install it', async () => {
        mockCanInstallSandbox.mockReturnValue(false);
        mockInstallDeviceSandbox.mockResolvedValue({
          instructions: 'sudo apt install bubblewrap',
          status: 'not-installable',
        });
        mockProbeSandboxCapability.mockResolvedValue({
          available: false,
          backend: 'none',
          networkIsolation: false,
          reason: 'bubblewrap is not installed',
        });

        const result = await ctr.installSandbox();

        expect(result.status).toBe('not-installable');
        expect(result.capability.canInstall).toBe(false);
        expect(result.capability.instructions).toBe('sudo apt install bubblewrap');
      });

      it('does not offer setup on a host that already has a sandbox', async () => {
        mockCanInstallSandbox.mockReturnValue(true);
        mockProbeSandboxCapability.mockResolvedValue({
          available: true,
          backend: 'srt',
          networkIsolation: true,
        });

        expect((await ctr.getSandboxCapability()).canInstall).toBe(false);
      });
    });

    describe('default workspace', () => {
      it('creates a per-agent directory and returns its real path', async () => {
        const result = await ctr.ensureSandboxWorkspace({ agentId: 'agt_abc123' });

        expect(result.path).toBeDefined();
        expect(result.path).toContain('LobeHub');
        expect(result.path).toContain('agt_abc123');
        // The policy layer resolves fence roots with realpath and rejects a
        // path that does not exist, so the directory must be real by now.
        expect(existsSync(result.path!)).toBe(true);

        rmSync(result.path!, { force: true, recursive: true });
      });

      it('never lets an agent id escape the workspace root', async () => {
        // The id becomes a path segment and is opaque to this process, so a
        // traversal attempt must land inside the sandbox root like any other
        // name — this directory is about to become a writable fence root.
        const root = join(homedir(), 'LobeHub', 'sandbox');
        const result = await ctr.ensureSandboxWorkspace({ agentId: '../../Windows/System32' });

        expect(result.path).toBeDefined();
        expect(result.path!.startsWith(root)).toBe(true);
        expect(relative(root, result.path!)).not.toContain('..');

        rmSync(result.path!, { force: true, recursive: true });
      });
    });

    it('treats a crashing probe as no sandbox', async () => {
      mockProbeSandboxCapability.mockRejectedValue(new Error('module not found'));

      expect(await ctr.getSandboxCapability()).toEqual({
        available: false,
        canInstall: true,
        reason: 'module not found',
      });
    });
  });

  it('should return error for non-existent shell_id', async () => {
    const result = await ctr.handleGetCommandOutput({
      shell_id: 'non-existent',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });
});
