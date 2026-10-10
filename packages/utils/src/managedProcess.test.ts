// @vitest-environment node
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ManagedProcessRegistry } from './managedProcess';

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((fn) => fn()));
});

describe.skipIf(process.platform === 'win32')('managed process shutdown', () => {
  const start = async (code: string) => {
    const registry = new ManagedProcessRegistry();
    const child = spawn(process.execPath, ['-e', code], { detached: true, stdio: 'pipe' });
    registry.register(child, true);
    cleanup.push(async () => {
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        /* already gone */
      }
      await registry.shutdown(0);
    });
    await once(child.stdout!, 'data');
    return { child, registry };
  };

  it('waits for a real process ignoring TERM, escalates, and refuses late launches', async () => {
    const { child, registry } = await start(
      `process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000);`,
    );
    const closing = registry.shutdown(80);
    expect(registry.shutdown()).toBe(closing);
    expect(() => registry.assertCanSpawn()).toThrow('shutting down');
    await closing;
    expect(alive(child.pid!)).toBe(false);
    expect(child.signalCode).toBe('SIGKILL');
  });

  it('reaps a background child even after the shell leader has exited', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'managed-process-'));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const pidFile = path.join(directory, 'pid');
    const code = `const {spawn} = require('child_process'); const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'ignore'}); require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); c.unref(); console.log('ready');`;
    const { child, registry } = await start(code);
    if (child.exitCode === null) await once(child, 'exit');
    const pid = Number(await readFile(pidFile, 'utf8'));
    expect(alive(pid)).toBe(true);
    await registry.shutdown(80);
    expect(alive(pid)).toBe(false);
  });

  it('discovers a child in a different process group without killing an unrelated process', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'managed-process-'));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const pidFile = path.join(directory, 'pid');
    const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    cleanup.push(async () => {
      unrelated.kill('SIGKILL');
    });
    const code = `const {spawn} = require('child_process'); const c = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)"], {detached: true, stdio: ['ignore', 'pipe', 'ignore']}); c.stdout.once('data', () => { require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); console.log('ready'); }); setInterval(() => {}, 1000);`;
    const { registry } = await start(code);
    const pid = Number(await readFile(pidFile, 'utf8'));
    cleanup.push(async () => {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* gone */
      }
    });
    await registry.shutdown(80);
    expect(alive(pid)).toBe(false);
    expect(alive(unrelated.pid!)).toBe(true);
  });
  it('reports owned memory and stops only the selected tree', async () => {
    const { child, registry } = await start("console.log('ready'); setInterval(() => {}, 1000)");
    const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    cleanup.push(async () => {
      unrelated.kill('SIGKILL');
    });
    registry.register(child, true, { topicId: 'topic-one', label: 'Dev server' });
    const snapshot = await registry.snapshot();
    const row = snapshot.processes.find((item) => item.pid === child.pid)!;
    expect(row.topicId).toBe('topic-one');
    expect(row.memoryMB).toBeGreaterThan(0);
    const rolledBack = Date.now() - 1000;
    vi.spyOn(Date, 'now').mockReturnValue(rolledBack);
    expect((await registry.snapshot()).sampledAt).toBe(rolledBack);
    vi.restoreAllMocks();
    expect(snapshot.processes.some((item) => item.pid === unrelated.pid)).toBe(false);
    await expect(registry.stop('stale-identity')).rejects.toThrow('already exited');
    expect(alive(child.pid!)).toBe(true);
    await registry.stop(row.rootId);
    expect(alive(child.pid!)).toBe(false);
    expect(alive(unrelated.pid!)).toBe(true);
  });
  it('adopts a detached browser daemon from its own namespace and reaps it after idle', async () => {
    const registry = new ManagedProcessRegistry();
    const env = registry.environment({ topicId: 'browser-topic' });
    expect(registry.environment({ topicId: 'browser-topic' }).AGENT_BROWSER_NAMESPACE).toBe(
      env.AGENT_BROWSER_NAMESPACE,
    );
    expect(registry.environment({ topicId: 'other-topic' }).AGENT_BROWSER_NAMESPACE).not.toBe(
      env.AGENT_BROWSER_NAMESPACE,
    );
    const daemon = spawn(
      process.execPath,
      [
        '-e',
        "process.title='agent-browser-regression'; console.log('ready'); setInterval(()=>{},1000)",
      ],
      { detached: true, stdio: 'pipe' },
    );
    cleanup.push(async () => {
      vi.restoreAllMocks();
      daemon.kill('SIGKILL');
      await registry.shutdown(0);
      await rm(env.AGENT_BROWSER_SOCKET_DIR, { recursive: true, force: true });
    });
    await once(daemon.stdout!, 'data');
    const directory = path.join(
      env.AGENT_BROWSER_SOCKET_DIR,
      'namespaces',
      env.AGENT_BROWSER_NAMESPACE,
      'run',
    );
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'default.pid'), String(daemon.pid));
    const snapshot = await registry.snapshot();
    expect(snapshot.processes.find((row) => row.pid === daemon.pid)).toMatchObject({
      topicId: 'browser-topic',
      label: 'Agent Browser · default',
    });
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 901000);
    await registry.snapshot();
    await vi.waitFor(() => expect(alive(daemon.pid!)).toBe(false), { timeout: 3000 });
    vi.restoreAllMocks();
  });
  it('owns processes launched from a separately evaluated lazy module', async () => {
    const eager = await import('./managedProcess');
    eager.enableManagedProcesses();
    vi.resetModules();
    const lazy = await import('./managedProcess');
    const child = lazy.spawnManaged(
      process.execPath,
      ['-e', "console.log('ready'); setInterval(() => {}, 1000)"],
      { detached: true, stdio: 'pipe' },
    );
    cleanup.push(async () => {
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        /* gone */
      }
    });
    await once(child.stdout!, 'data');
    await eager.shutdownManagedProcesses();
    expect(alive(child.pid!)).toBe(false);
    expect(() => lazy.spawnManaged(process.execPath, ['-e', ''])).toThrow('shutting down');
  });

  it('keeps the launching message on every process the owner env spawns', async () => {
    // An earlier test shut the host-wide registry down; start from a fresh one.
    delete (globalThis as Record<symbol, unknown>)[Symbol.for('lobehub.managedProcesses')];
    vi.resetModules();
    const managed = await import('./managedProcess');
    managed.enableManagedProcesses();
    const env = managed.managedProcessEnvironment({
      agentId: 'agt_1',
      groupId: 'grp_1',
      label: 'dev server',
      messageId: 'msg_tool_1',
      topicId: 'tpc_1',
      workspaceId: 'ws_1',
    });
    expect(env.LOBEHUB_PROCESS_MESSAGE).toBe('msg_tool_1');
    const child = managed.spawnManaged(
      process.execPath,
      ['-e', "console.log('ready'); setInterval(() => {}, 1000)"],
      { detached: true, env: { ...process.env, ...env }, stdio: 'pipe' },
    );
    cleanup.push(() => managed.shutdownManagedProcesses());
    await once(child.stdout!, 'data');
    const { processes } = await managed.getManagedProcesses();
    expect(processes.find((row) => row.pid === child.pid)).toMatchObject({
      agentId: 'agt_1',
      groupId: 'grp_1',
      messageId: 'msg_tool_1',
      topicId: 'tpc_1',
      workspaceId: 'ws_1',
    });
  });

  it('keeps only the launch owner every candidate call agrees on, and still reaps it', async () => {
    const registry = new ManagedProcessRegistry();
    // Two calls in one topic share the namespace before the daemon is sampled:
    // the later call must not claim a daemon the earlier one may have started.
    const raced = registry.environment({ messageId: 'msg_a', topicId: 'race-topic' });
    registry.environment({ messageId: 'msg_b', topicId: 'race-topic' });
    // Two members of a group topic: the agent is just as ambiguous as the message.
    const group = registry.environment({
      agentId: 'agt_coder',
      groupId: 'grp_1',
      messageId: 'msg_coder',
      topicId: 'group-topic',
    });
    registry.environment({
      agentId: 'agt_reviewer',
      groupId: 'grp_1',
      messageId: 'msg_reviewer',
      topicId: 'group-topic',
    });
    const solo = registry.environment({
      agentId: 'agt_solo',
      messageId: 'msg_solo',
      topicId: 'solo-topic',
    });
    const envs = [raced, group, solo];
    const daemons = envs.map(() =>
      spawn(
        process.execPath,
        [
          '-e',
          "process.title='agent-browser-owner'; console.log('ready'); setInterval(()=>{},1000)",
        ],
        { detached: true, stdio: 'pipe' },
      ),
    );
    cleanup.push(async () => {
      vi.restoreAllMocks();
      for (const daemon of daemons) daemon.kill('SIGKILL');
      await registry.shutdown(0);
      await rm(raced.AGENT_BROWSER_SOCKET_DIR, { recursive: true, force: true });
    });
    await Promise.all(daemons.map((daemon) => once(daemon.stdout!, 'data')));
    for (const [index, env] of envs.entries()) {
      const directory = path.join(
        env.AGENT_BROWSER_SOCKET_DIR,
        'namespaces',
        env.AGENT_BROWSER_NAMESPACE,
        'run',
      );
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, 'default.pid'), String(daemons[index].pid));
    }
    const { processes } = await registry.snapshot();
    const row = (index: number) => processes.find((item) => item.pid === daemons[index].pid);
    expect(row(0)).toMatchObject({ topicId: 'race-topic' });
    expect(row(0)?.messageId).toBeUndefined();
    expect(row(1)).toMatchObject({ groupId: 'grp_1', topicId: 'group-topic' });
    expect(row(1)?.agentId).toBeUndefined();
    expect(row(1)?.messageId).toBeUndefined();
    expect(row(2)).toMatchObject({
      agentId: 'agt_solo',
      messageId: 'msg_solo',
      topicId: 'solo-topic',
    });

    // A daemon left without an agent is still its namespace's, so idle cleanup finds it.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 901000);
    await registry.snapshot();
    await vi.waitFor(() => expect(alive(daemons[1].pid!)).toBe(false), { timeout: 3000 });
  });
});
