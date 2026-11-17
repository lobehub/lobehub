// @vitest-environment node
import { EventEmitter } from 'node:events';

import { Client, Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { type MeteredPool, PoolGroup, registerPoolStats, takePoolStatsLine } from './poolStats';

/** A pool that reports the counts it is given and emits pg.Pool's events on demand. */
const fakePool = (counts = { idleCount: 0, totalCount: 0, waitingCount: 0 }) => {
  const events = new EventEmitter();
  const pool = Object.assign(events, counts) as unknown as MeteredPool &
    EventEmitter &
    typeof counts;
  return {
    acquire: () => events.emit('acquire', {}),
    connect: () => events.emit('connect', {}),
    pool,
    release: () => events.emit('release', undefined, {}),
  };
};

describe('PoolGroup', () => {
  it('sums the pools and keeps the borrowed peak of the interval', () => {
    const group = new PoolGroup();
    const a = fakePool({ idleCount: 1, totalCount: 3, waitingCount: 0 });
    const b = fakePool({ idleCount: 0, totalCount: 2, waitingCount: 1 });
    group.track(a.pool);
    group.track(b.pool);

    a.connect();
    a.connect();
    b.connect();
    a.acquire();
    a.acquire();
    b.acquire();
    b.acquire();
    // Peak: 4 at once over the group, 2 in one pool. Then back to one borrowed.
    a.release();
    a.release();
    b.release();

    expect(group.take()).toEqual({
      borrowed: 1,
      connectErrors: 0,
      connects: 3,
      idle: 1,
      maxBorrowed: 4,
      maxBorrowedPerPool: 2,
      pools: 2,
      total: 5,
      waiting: 1,
    });
    // The next interval starts from what is still borrowed.
    expect(group.take()).toMatchObject({
      borrowed: 1,
      connects: 0,
      maxBorrowed: 1,
      maxBorrowedPerPool: 1,
    });
  });

  it('keeps the peak of a pool removed during the interval, then forgets the pool', () => {
    const group = new PoolGroup();
    const a = fakePool({ idleCount: 0, totalCount: 3, waitingCount: 0 });
    const untrack = group.track(a.pool);
    a.acquire();
    a.acquire();
    a.acquire();
    a.release();
    a.release();
    a.release();
    untrack();
    untrack();

    expect(group.take()).toMatchObject({
      borrowed: 0,
      maxBorrowed: 3,
      maxBorrowedPerPool: 3,
      pools: 0,
      total: 0,
    });
    expect(group.take()).toMatchObject({ maxBorrowed: 0, maxBorrowedPerPool: 0 });
  });

  it('forwards the connected client to callback consumers', () => {
    const group = new PoolGroup();
    const client = new group.Client();
    const callback = vi.fn();
    const connect = vi.spyOn(Client.prototype, 'connect').mockImplementation(function (
      this: Client,
      callback,
    ) {
      (callback as (error: null, client: Client) => void)(null, this);
    });
    try {
      client.connect(callback);
      expect(callback).toHaveBeenCalledExactlyOnceWith(null, client);
      expect(group.take().connectErrors).toBe(0);
    } finally {
      connect.mockRestore();
    }
  });

  it('preserves rejected promise connections and counts the failure once', async () => {
    const group = new PoolGroup();
    const client = new group.Client({ connectionTimeoutMillis: 2000, host: '127.0.0.1', port: 1 });
    try {
      await expect(client.connect()).rejects.toThrow();
      expect(group.take().connectErrors).toBe(1);
    } finally {
      await client.end();
    }
  });

  it('counts a physical connection that fails to open, through a real pg.Pool', async () => {
    const group = new PoolGroup();
    // Port 1 on loopback refuses at once: no server, no network.
    const pool = new Pool({
      Client: group.Client,
      connectionTimeoutMillis: 2000,
      host: '127.0.0.1',
      port: 1,
    });
    group.track(pool);
    try {
      await expect(pool.query('select 1')).rejects.toThrow();
      await expect(pool.connect()).rejects.toThrow();
      expect(group.take()).toMatchObject({ borrowed: 0, connectErrors: 2, connects: 0, total: 0 });
    } finally {
      await pool.end();
    }
  });
});

describe('db.pool.stats line', () => {
  it('carries every registered purpose and the process, and nothing about tenants', () => {
    const group = new PoolGroup();
    const a = fakePool({ idleCount: 2, totalCount: 2, waitingCount: 0 });
    group.track(a.pool);
    a.connect();
    registerPoolStats('platform', () => group.take());

    const line = takePoolStatsLine();
    expect(line).toMatchObject({
      event: 'db.pool.stats',
      pid: process.pid,
      pools: { platform: { connects: 1, idle: 2, pools: 1, total: 2 } },
    });
    expect(typeof line.service).toBe('string');
    expect(typeof line.pod).toBe('string');
    // One line for the log collector.
    expect(JSON.stringify(line)).not.toContain('\n');
  });
});
