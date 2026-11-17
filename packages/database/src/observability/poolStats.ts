import { Client, Pool, type PoolConfig } from 'pg';

import { dbApplicationName, dbProcessIdentity } from './applicationName';

/**
 * Connection pool statistics, written once a minute per process as one
 * `db.pool.stats` log line (the logs are the metric channel). Counts only:
 * no tenant, schema, user or credential ever reaches a line.
 */

/** What a group reads from each of its pools: pg.Pool's counters and events. */
export type MeteredPool = Pick<Pool, 'idleCount' | 'on' | 'totalCount' | 'waitingCount'>;

export interface PoolGroupStats {
  /** Connections handed out right now (acquired and not yet released). */
  borrowed: number;
  /** Physical connections that failed to open since the previous line. */
  connectErrors: number;
  /** Physical connections opened since the previous line. */
  connects: number;
  idle: number;
  /** Most connections the group had handed out at once since the previous line. */
  maxBorrowed: number;
  /** Most connections a single pool had handed out at once since the previous line. */
  maxBorrowedPerPool: number;
  pools: number;
  total: number;
  waiting: number;
}

interface Meter {
  borrowed: number;
  maxBorrowed: number;
  pool: MeteredPool;
}

/**
 * The pools of one purpose (`platform`, `tenant`, ...). Borrowed connections
 * are counted from the pools' `acquire` / `release` events, opened ones from
 * `connect`; failed opens from {@link PoolGroup.Client}, the pg.Client the
 * pools are created with. Interval counters reset when a line is taken.
 */
export class PoolGroup {
  private readonly meters = new Set<Meter>();
  private borrowed = 0;
  private maxBorrowed = 0;
  private connects = 0;
  private connectErrors = 0;
  // Per-pool peak of pools removed since the previous line.
  private removedMaxBorrowed = 0;
  private client?: typeof Client;

  /**
   * pg.Client that counts a failed physical connect (refused, authentication,
   * the pool's connection timeout) and otherwise behaves exactly as pg.Client.
   * pg.Pool reports no event for those failures. Created on first use.
   */
  get Client(): typeof Client {
    if (this.client) return this.client;
    const onConnectError = () => {
      this.connectErrors += 1;
    };
    class MeteredClient extends Client {
      // Same overloads as pg.Client#connect: callback (pg.Pool) or promise.
      connect(): Promise<Client>;
      connect(callback: Parameters<Client['connect']>[0]): void;
      connect(callback?: Parameters<Client['connect']>[0]): Promise<Client> | void {
        if (!callback)
          return super.connect().catch((error: unknown) => {
            onConnectError();
            throw error;
          });
        return super.connect((...args: [Error] | [null, Client]) => {
          if (args[0]) onConnectError();
          Reflect.apply(callback, undefined, args);
        });
      }
    }
    this.client = MeteredClient;
    return MeteredClient;
  }

  /** Starts counting a pool's events. Returns the function that stops listing it. */
  track(pool: MeteredPool): () => void {
    const meter: Meter = { borrowed: 0, maxBorrowed: 0, pool };
    pool.on('connect', () => {
      this.connects += 1;
    });
    pool.on('acquire', () => {
      meter.borrowed += 1;
      meter.maxBorrowed = Math.max(meter.maxBorrowed, meter.borrowed);
      this.borrowed += 1;
      this.maxBorrowed = Math.max(this.maxBorrowed, this.borrowed);
    });
    pool.on('release', () => {
      meter.borrowed -= 1;
      this.borrowed -= 1;
    });
    this.meters.add(meter);
    return () => {
      if (!this.meters.delete(meter)) return;
      this.removedMaxBorrowed = Math.max(this.removedMaxBorrowed, meter.maxBorrowed);
    };
  }

  /** Current counts plus the interval counters, which then start over. */
  take(): PoolGroupStats {
    let total = 0;
    let idle = 0;
    let waiting = 0;
    let maxBorrowedPerPool = this.removedMaxBorrowed;
    for (const meter of this.meters) {
      total += meter.pool.totalCount;
      idle += meter.pool.idleCount;
      waiting += meter.pool.waitingCount;
      maxBorrowedPerPool = Math.max(maxBorrowedPerPool, meter.maxBorrowed);
      meter.maxBorrowed = meter.borrowed;
    }
    const stats: PoolGroupStats = {
      borrowed: this.borrowed,
      connectErrors: this.connectErrors,
      connects: this.connects,
      idle,
      maxBorrowed: this.maxBorrowed,
      maxBorrowedPerPool,
      pools: this.meters.size,
      total,
      waiting,
    };
    this.connects = 0;
    this.connectErrors = 0;
    this.maxBorrowed = this.borrowed;
    this.removedMaxBorrowed = 0;
    return stats;
  }
}

export const POOL_STATS_INTERVAL_MS = 60_000;

const sources = new Map<string, () => object>();
let timer: ReturnType<typeof setInterval> | undefined;

/** One `db.pool.stats` line: every registered purpose's stats. Starts their next interval. */
export const takePoolStatsLine = () => {
  const pools: Record<string, object> = {};
  for (const [purpose, take] of sources) pools[purpose] = take();
  return { event: 'db.pool.stats', ...dbProcessIdentity(), pools };
};

/**
 * Adds a purpose to this process's `db.pool.stats` line (replacing an earlier
 * source of the same purpose) and starts the once-a-minute line. The timer is
 * unref'd: it never keeps a process alive.
 */
export const registerPoolStats = (purpose: string, take: () => object) => {
  sources.set(purpose, take);
  if (timer) return;
  timer = setInterval(() => {
    try {
      // One JSON line: the log collector parses it; a multi-line object would split.
      console.info(JSON.stringify(takePoolStatsLine()));
    } catch {
      // Observability must not take the process down.
    }
  }, POOL_STATS_INTERVAL_MS);
  timer.unref?.();
};

/**
 * A pg.Pool named `purpose` in `application_name` and counted under the same
 * purpose in `db.pool.stats`. `config` is passed through unchanged otherwise.
 */
export const createObservedPool = (purpose: string, config: PoolConfig): Pool => {
  const group = new PoolGroup();
  const pool = new Pool({
    ...config,
    application_name: dbApplicationName(purpose),
    Client: group.Client,
  });
  group.track(pool);
  registerPoolStats(purpose, () => group.take());
  return pool;
};
