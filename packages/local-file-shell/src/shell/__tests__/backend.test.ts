import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ShellBackend, ShellHandle, ShellLaunchCommand, ShellSpawnOptions } from '../backend';
import { ChildProcessBackend } from '../child-process-backend';
import { ShellProcessManager } from '../process-manager';
import { runCommand } from '../runner';

type FakeHandle = EventEmitter & {
  exitCode: number | null;
  pid?: number;
  signalCode: NodeJS.Signals | null;
};

/** Backend double: never starts a process, records what it was asked to do. */
class FakeBackend implements ShellBackend {
  readonly capabilities = { interactive: true, persistent: false, streaming: true };
  readonly name = 'fake';

  readonly handles = new Map<string, FakeHandle>();
  readonly spawnCalls: { command: ShellLaunchCommand; options: ShellSpawnOptions }[] = [];
  readonly kill = vi.fn((shellId: string) => {
    const handle = this.handles.get(shellId);
    if (!handle) throw new Error(`Shell ID ${shellId} not found`);
    Object.assign(handle, { signalCode: 'SIGKILL' });
    handle.emit('exit', null, 'SIGKILL');
    handle.emit('close', null, 'SIGKILL');
  });

  readonly release = vi.fn((shellId: string) => {
    this.handles.delete(shellId);
  });

  spawn(command: ShellLaunchCommand, options: ShellSpawnOptions): ShellHandle {
    this.spawnCalls.push({ command, options });
    const handle: FakeHandle = Object.assign(new EventEmitter(), {
      exitCode: null,
      signalCode: null,
    });
    this.handles.set(options.shellId, handle);
    return handle;
  }

  /** Simulate the command writing `output` to stdout and exiting with `code`. */
  finish(shellId: string, output: string, code: number): void {
    const handle = this.handles.get(shellId)!;
    fs.appendFileSync(this.spawnCalls.at(-1)!.options.outputFiles.stdout.path, output);
    handle.exitCode = code;
    handle.emit('exit', code, null);
    handle.emit('close', code, null);
  }
}

describe('ShellBackend injection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lobehub-shell-backend-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  it('should default ShellProcessManager to the non-interactive ChildProcessBackend', () => {
    const manager = new ShellProcessManager(tmpDir);

    expect(manager.backend).toBeInstanceOf(ChildProcessBackend);
    expect(manager.backend.capabilities).toEqual({
      interactive: false,
      persistent: false,
      streaming: false,
    });
    expect(manager.backend.write).toBeUndefined();
    expect(manager.backend.onOutput).toBeUndefined();
    manager.cleanupAll();
  });

  it('should spawn, observe and kill through the manager backend', async () => {
    const backend = new FakeBackend();
    const manager = new ShellProcessManager(tmpDir, backend);

    const started = await runCommand(
      { command: 'echo hi', cwd: tmpDir, env: { FOO: 'bar' }, run_in_background: true },
      { processManager: manager },
    );

    expect(started).toMatchObject({ success: true });
    // Shell ids carry a per-process token (see `ShellProcessManager.createShellId`).
    expect(started.shell_id).toMatch(/^sh-[\da-f]{6}-1$/);
    const shellId = started.shell_id!;
    expect(backend.spawnCalls).toHaveLength(1);
    const [{ command, options }] = backend.spawnCalls;
    expect(command.args.at(-1)).toContain('echo hi');
    expect(options).toMatchObject({ cwd: tmpDir, shellId });
    expect(options.env.FOO).toBe('bar');
    expect(options.outputFiles.stdout.path).toContain(path.join(shellId, 'stdout.log'));

    backend.finish(shellId, 'from fake backend\n', 3);
    const output = await manager.getOutput({ shell_id: shellId, timeout: 1000 });
    expect(output).toMatchObject({
      exit_code: 3,
      running: false,
      stdout: 'from fake backend\n',
      success: true,
    });

    expect(manager.kill(shellId)).toEqual({ success: true });
    expect(backend.kill).toHaveBeenCalledWith(shellId);

    manager.cleanupAll();
    expect(backend.release).toHaveBeenCalledWith(shellId);
  });

  it('should let runCommand override the backend and still kill through it', async () => {
    const manager = new ShellProcessManager(tmpDir);
    const backend = new FakeBackend();

    const started = await runCommand(
      { command: 'sleep 100', run_in_background: true },
      { backend, processManager: manager },
    );

    expect(backend.spawnCalls).toHaveLength(1);
    expect(manager.kill(started.shell_id!)).toEqual({ success: true });
    expect(backend.kill).toHaveBeenCalledWith(started.shell_id);

    const output = await manager.getOutput({ shell_id: started.shell_id!, timeout: 1000 });
    expect(output).toMatchObject({ running: false, signal: 'SIGKILL' });
    manager.cleanupAll();
  });

  it('should spawn through a caller-supplied spawnProcess on the default backend', async () => {
    // The desktop passes a spawn that registers each process with its
    // managed-process tracker; the backend abstraction must keep using it.
    const manager = new ShellProcessManager(tmpDir);
    const { spawn } = await import('node:child_process');
    const spawnProcess = vi.fn(spawn);

    const result = await runCommand(
      { command: 'echo tracked' },
      { processManager: manager, spawnProcess: spawnProcess as unknown as typeof spawn },
    );

    expect(spawnProcess).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ success: true });
    expect(result.stdout).toContain('tracked');
    manager.cleanupAll();
  });

  it('should report a backend spawn failure as a failed command', async () => {
    const manager = new ShellProcessManager(tmpDir);
    const backend = new FakeBackend();
    vi.spyOn(backend, 'spawn').mockImplementation(() => {
      throw new Error('backend unavailable');
    });

    const result = await runCommand({ command: 'echo hi' }, { backend, processManager: manager });

    expect(result).toEqual({ error: 'backend unavailable', success: false });
    manager.cleanupAll();
  });
});

describe('ChildProcessBackend', () => {
  it('should refuse to kill an id it never spawned', () => {
    expect(() => new ChildProcessBackend().kill('sh-404')).toThrow('Shell ID sh-404 not found');
  });
});
