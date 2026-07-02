import net from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { __testing } from './devStartupSequence.mts';

const { findFreePort, resolveNextPort, resolveVitePortEnv } = __testing;

const listenOnPort = (port: number) =>
  new Promise<net.Server>((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, () => resolve(server));
  });

const closeServer = (server: net.Server) =>
  new Promise<void>((resolve) => {
    server.close(() => resolve());
  });

const originalArgv = [...process.argv];

afterEach(() => {
  process.argv = [...originalArgv];
  vi.unstubAllEnvs();
});

describe('findFreePort', () => {
  it('returns the start port when it is free', async () => {
    const free = await findFreePort(45_678);
    expect(free).toBe(45_678);
  });

  it('skips an occupied port', async () => {
    const occupied = await listenOnPort(45_679);
    try {
      const free = await findFreePort(45_679);
      expect(free).toBe(45_680);
    } finally {
      await closeServer(occupied);
    }
  });
});

describe('resolveNextPort', () => {
  it('prefers the -p CLI flag over PORT env', async () => {
    process.argv = [...originalArgv, '-p', '4321'];
    vi.stubEnv('PORT', '5555');

    await expect(resolveNextPort()).resolves.toBe(4321);
  });

  it('uses PORT env verbatim even when occupied', async () => {
    const occupied = await listenOnPort(45_681);
    vi.stubEnv('PORT', '45681');
    try {
      await expect(resolveNextPort()).resolves.toBe(45_681);
    } finally {
      await closeServer(occupied);
    }
  });

  it('falls back to scanning from 3010', async () => {
    vi.stubEnv('PORT', '');
    delete process.env.PORT;

    const port = await resolveNextPort();
    expect(port).toBeGreaterThanOrEqual(3010);
  });
});

describe('resolveVitePortEnv', () => {
  it('honors an explicit SPA_PORT and injects VITE_DEV_PORT', async () => {
    vi.stubEnv('MOBILE', '');
    vi.stubEnv('SPA_PORT', '4567');
    vi.stubEnv('VITE_DEV_PORT', '');

    const port = await resolveVitePortEnv();

    expect(port).toBe(4567);
    expect(process.env.SPA_PORT).toBe('4567');
    expect(process.env.VITE_DEV_PORT).toBe('4567');
  });

  it('uses MOBILE_SPA_PORT when MOBILE=true', async () => {
    vi.stubEnv('MOBILE', 'true');
    vi.stubEnv('MOBILE_SPA_PORT', '4568');
    vi.stubEnv('VITE_DEV_PORT', '');

    const port = await resolveVitePortEnv();

    expect(port).toBe(4568);
    expect(process.env.MOBILE_SPA_PORT).toBe('4568');
    expect(process.env.VITE_DEV_PORT).toBe('4568');
  });

  it('scans from the default and injects both env vars when unset', async () => {
    vi.stubEnv('MOBILE', '');
    delete process.env.SPA_PORT;
    vi.stubEnv('VITE_DEV_PORT', '');

    const port = await resolveVitePortEnv();

    expect(port).toBeGreaterThanOrEqual(9876);
    expect(process.env.SPA_PORT).toBe(String(port));
    expect(process.env.VITE_DEV_PORT).toBe(String(port));
  });
});
