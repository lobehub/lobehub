import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { Socket } from 'node:net';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSandboxLaunchPlan } from '../launchPlan';
import { srtSandboxRuntime } from '../runtime';
import type { SandboxLaunchPlan, SandboxPolicy } from '../types';

const run = async (plan: SandboxLaunchPlan) =>
  new Promise<{ exitCode: number | null; stderr: string; stdout: string }>((resolve, reject) => {
    const child = spawn(plan.cmd, plan.args, { env: plan.env as NodeJS.ProcessEnv });
    let stderr = '';
    let stdout = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.once('error', (error) => {
      plan.release?.();
      reject(error);
    });
    child.once('close', (exitCode) => {
      plan.release?.();
      resolve({ exitCode, stderr, stdout });
    });
  });

describe.skipIf(process.platform !== 'darwin')('Anthropic sandbox-runtime integration', () => {
  let allowedRoot: string;
  let deniedRoot: string;
  let policy: SandboxPolicy;

  beforeEach(async () => {
    allowedRoot = await mkdtemp(path.join(os.tmpdir(), 'device-srt-allowed-'));
    deniedRoot = await mkdtemp(path.join(os.tmpdir(), 'device-srt-denied-'));
    policy = {
      allowNetwork: false,
      deniedReadRoots: [deniedRoot],
      onUnavailable: 'deny',
      readableRoots: [allowedRoot],
      writableRoots: [allowedRoot],
    };
  });

  afterEach(async () => {
    await srtSandboxRuntime.shutdown();
    await Promise.all([
      rm(allowedRoot, { force: true, recursive: true }),
      rm(deniedRoot, { force: true, recursive: true }),
    ]);
  });

  const runShell = async (command: string) => {
    const plan = await createSandboxLaunchPlan({
      command: { args: ['-c', command], cmd: '/bin/sh' },
      env: process.env,
      policy,
    });
    return run(plan);
  };

  it('allows approved writes and denies writes outside the root', async () => {
    const allowedTarget = path.join(allowedRoot, 'allowed.txt');
    const deniedTarget = path.join(deniedRoot, 'denied.txt');

    const allowed = await runShell(`printf allowed > ${JSON.stringify(allowedTarget)}`);
    const denied = await runShell(`printf denied > ${JSON.stringify(deniedTarget)}`);

    expect(allowed.exitCode).toBe(0);
    await expect(readFile(allowedTarget, 'utf8')).resolves.toBe('allowed');
    expect(denied.exitCode).not.toBe(0);
  });

  it('denies reads from configured sensitive roots', async () => {
    const secretPath = path.join(deniedRoot, 'secret.txt');
    await writeFile(secretPath, 'secret');

    const result = await runShell(`cat ${JSON.stringify(secretPath)}`);

    expect(result.exitCode).not.toBe(0);
  });

  it('does not expose environment variables outside the allowlist', async () => {
    const plan = await createSandboxLaunchPlan({
      command: {
        args: ['-c', 'printf "%s" "${LOB_TEST_SRT_SECRET-unset}"'],
        cmd: '/bin/sh',
      },
      env: { ...process.env, LOB_TEST_SRT_SECRET: 'must-not-leak' },
      policy,
    });

    const result = await run(plan);

    expect(result).toMatchObject({ exitCode: 0, stdout: 'unset' });
  });

  it('blocks direct loopback connections before they reach the host server', async () => {
    let acceptedConnections = 0;
    const server = createServer((socket) => {
      acceptedConnections += 1;
      socket.destroy();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('TCP server did not bind');

    try {
      const result = await runShell(
        `node -e "require('net').connect(${address.port}, '127.0.0.1').on('error', () => process.exit(7))"`,
      );

      expect(result.exitCode).toBe(7);
      expect(acceptedConnections).toBe(0);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('allows only explicitly listed domains through the Sandbox Runtime proxy', async () => {
    let acceptedConnections = 0;
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      acceptedConnections += 1;
      socket.end('HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: 7\r\n\r\nallowed');
    });
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('HTTP server did not bind');
    policy = {
      ...policy,
      allowedNetworkDomains: ['localhost'],
      allowNetwork: true,
    };

    try {
      const allowed = await runShell(
        `/usr/bin/curl --max-time 2 --silent --fail --noproxy '' http://localhost:${address.port}`,
      );
      const denied = await runShell(
        `/usr/bin/curl --max-time 2 --silent --fail --noproxy '' http://127.0.0.1:${address.port}`,
      );

      expect(allowed).toMatchObject({ exitCode: 0, stdout: 'allowed' });
      expect(denied.exitCode).not.toBe(0);
      expect(acceptedConnections).toBe(1);
    } finally {
      for (const socket of sockets) socket.destroy();
      server.close();
    }
  }, 10_000);

  it('keeps one fixed policy while commands overlap and refuses premature reset', async () => {
    const first = await createSandboxLaunchPlan({
      command: { args: ['-c', 'printf first'], cmd: '/bin/sh' },
      policy,
    });
    const second = await createSandboxLaunchPlan({
      command: { args: ['-c', 'printf second'], cmd: '/bin/sh' },
      policy,
    });

    await expect(srtSandboxRuntime.shutdown()).rejects.toMatchObject({ code: 'SANDBOX_BUSY' });

    const [firstResult, secondResult] = await Promise.all([run(first), run(second)]);
    expect(firstResult).toMatchObject({ exitCode: 0, stdout: 'first' });
    expect(secondResult).toMatchObject({ exitCode: 0, stdout: 'second' });
  });

  it('rejects a different device policy until the current session is reset', async () => {
    const first = await createSandboxLaunchPlan({
      command: { args: ['-c', 'true'], cmd: '/bin/sh' },
      policy,
    });
    await run(first);

    await expect(
      createSandboxLaunchPlan({
        command: { args: ['-c', 'true'], cmd: '/bin/sh' },
        policy: { ...policy, writableRoots: [deniedRoot] },
      }),
    ).rejects.toMatchObject({ code: 'SANDBOX_POLICY_CONFLICT' });

    await srtSandboxRuntime.shutdown();
    const next = await createSandboxLaunchPlan({
      command: { args: ['-c', 'true'], cmd: '/bin/sh' },
      policy: { ...policy, writableRoots: [deniedRoot] },
    });
    await expect(run(next)).resolves.toMatchObject({ exitCode: 0 });
  });

  it('preserves shell arguments containing quotes without host-shell injection', async () => {
    const marker = path.join(deniedRoot, 'injected.txt');
    const plan = await createSandboxLaunchPlan({
      command: {
        args: ["value with spaces and 'quotes'; touch " + marker],
        cmd: '/bin/echo',
      },
      policy,
    });

    const result = await run(plan);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("value with spaces and 'quotes'; touch");
    await expect(readFile(marker, 'utf8')).rejects.toThrow();
  });
});
