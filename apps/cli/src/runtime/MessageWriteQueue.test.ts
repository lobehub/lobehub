import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageWriteQueue } from './MessageWriteQueue';
import type { MessageSyncOperation } from './messageSync';

let dir: string;
let logPath: string;

const op = (id: string): MessageSyncOperation => ({
  message: { content: id, id, role: 'assistant' },
  type: 'createMessage',
});

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'write-queue-'));
  logPath = path.join(dir, 'pending.jsonl');
});

afterEach(async () => {
  await fs.rm(dir, { force: true, recursive: true });
});

describe('MessageWriteQueue', () => {
  it('does not make the caller wait on the sink', async () => {
    let release: () => void = () => {};
    const queue = new MessageWriteQueue({
      sink: { flush: () => new Promise<void>((resolve) => (release = resolve)) },
    });

    // The whole point: enqueue is synchronous, so the agent loop never blocks
    // on replication.
    await queue.enqueue(op('a'));
    expect(queue.pending).toBe(1);

    release();
  });

  it('coalesces operations that arrive while a batch is in flight', async () => {
    const batches: number[] = [];
    let resolveFirst: () => void = () => {};
    const queue = new MessageWriteQueue({
      sink: {
        flush: async (operations) => {
          batches.push(operations.length);
          if (batches.length === 1) await new Promise<void>((r) => (resolveFirst = r));
        },
      },
    });

    await queue.enqueue(op('a'));
    await vi.waitFor(() => expect(batches).toHaveLength(1));

    // Three more arrive mid-flight; they should ship as ONE follow-up batch,
    // not three round trips queued behind each other.
    await queue.enqueue(op('b'));
    await queue.enqueue(op('c'));
    await queue.enqueue(op('d'));
    resolveFirst();
    await queue.drain();

    expect(batches).toEqual([1, 3]);
  });

  it('retries a failing batch and reports failure only after giving up', async () => {
    let attempts = 0;
    const queue = new MessageWriteQueue({
      initialBackoffMs: 1,
      sink: {
        flush: async () => {
          attempts += 1;
          if (attempts < 3) throw new Error('network down');
        },
      },
    });

    await queue.enqueue(op('a'));
    await queue.drain();

    expect(attempts).toBe(3);
    expect(queue.failed).toBe(false);
  });

  it('leaves unconfirmed operations on disk and replays them after a crash', async () => {
    // First process: the sink never succeeds, so nothing is confirmed.
    const dying = new MessageWriteQueue({
      initialBackoffMs: 1,
      logPath,
      onError: () => {},
      sink: { flush: async () => { throw new Error('offline'); } },
    });
    await dying.enqueue(op('a'));
    await dying.enqueue(op('b'));
    await dying.drain().catch(() => {});

    expect((await fs.readFile(logPath, 'utf8')).trim().split('\n')).toHaveLength(2);

    // Second process, network restored: the log is replayed, then cleared.
    const delivered: MessageSyncOperation[] = [];
    const revived = new MessageWriteQueue({
      logPath,
      sink: {
        flush: async (operations) => {
          delivered.push(...operations);
        },
      },
    });

    expect(await revived.recover()).toBe(2);
    await revived.drain();

    expect(delivered.map((o) => (o.type === 'createMessage' ? o.message.id : ''))).toEqual([
      'a',
      'b',
    ]);
    await expect(fs.readFile(logPath, 'utf8')).rejects.toThrow();
  });

  it('survives a replay of a batch the backend already has', async () => {
    // The crash window: the sink commits, then the process dies before the
    // acknowledgement is recorded. On restart the identical batch is replayed
    // and a plain-insert backend rejects it as a duplicate. Without the
    // classifier that batch fails forever, exhausts its retries, and ends ALL
    // later replication for the run.
    await fs.writeFile(logPath, `${JSON.stringify(op('a'))}\n`, 'utf8');

    let calls = 0;
    const queue = new MessageWriteQueue({
      initialBackoffMs: 1,
      logPath,
      sink: {
        flush: async () => {
          calls += 1;
          throw new Error('duplicate key value violates unique constraint');
        },
        isAlreadyApplied: (error) => String(error).includes('duplicate key'),
      },
    });

    expect(await queue.recover()).toBe(1);
    await queue.drain();

    expect(calls).toBe(1);
    expect(queue.failed).toBe(false);
    // Acknowledged, so the log is cleared rather than replayed again forever.
    await expect(fs.readFile(logPath, 'utf8')).rejects.toThrow();
  });

  it('without the classifier a replayed batch still stops replication', async () => {
    // Documents why `isAlreadyApplied` exists: this is the behaviour it fixes.
    await fs.writeFile(logPath, `${JSON.stringify(op('a'))}\n`, 'utf8');

    const queue = new MessageWriteQueue({
      initialBackoffMs: 1,
      logPath,
      onError: () => {},
      sink: { flush: async () => { throw new Error('duplicate key'); } },
    });

    await queue.recover();
    await queue.drain().catch(() => {});
    expect(queue.failed).toBe(true);
  });

  it('has the record on disk before the enqueue resolves', async () => {
    const queue = new MessageWriteQueue({
      logPath,
      sink: { flush: () => new Promise<void>(() => {}) },
    });

    await queue.enqueue(op('a'));

    // Not "eventually" — by the time enqueue resolves. Anything less leaves a
    // window where an operation is neither sent nor recoverable.
    expect((await fs.readFile(logPath, 'utf8')).trim()).toBe(JSON.stringify(op('a')));
  });

  it('reports an unwritable log instead of failing the run', async () => {
    const warnings: string[] = [];
    const queue = new MessageWriteQueue({
      // A directory where the file should be — appending can never succeed.
      logPath: dir,
      onError: (message) => warnings.push(message),
      sink: { flush: async () => {} },
    });

    // Replication is no longer crash-safe, and that is surfaced — but a working
    // run is not killed because its replica log is inaccessible.
    await expect(queue.enqueue(op('a'))).resolves.toBeUndefined();
    expect(queue.degraded).toBe(true);
    expect(warnings.join()).toContain('not durable');

    await queue.drain();
  });

  it('recovers the intact entries when the last log line was truncated', async () => {
    // A process killed mid-append leaves a partial trailing line. The entries
    // before it are still deliverable and must not be thrown away with it.
    await fs.writeFile(logPath, `${JSON.stringify(op('a'))}\n{"type":"createMess`, 'utf8');

    const delivered: MessageSyncOperation[] = [];
    const queue = new MessageWriteQueue({
      logPath,
      onError: () => {},
      sink: {
        flush: async (operations) => {
          delivered.push(...operations);
        },
      },
    });

    expect(await queue.recover()).toBe(1);
    await queue.drain();
    expect(delivered).toHaveLength(1);
  });

  it('keeps operations appended while a batch was in flight', async () => {
    let resolveFirst: () => void = () => {};
    let calls = 0;
    const queue = new MessageWriteQueue({
      logPath,
      sink: {
        flush: async () => {
          calls += 1;
          if (calls === 1) await new Promise<void>((r) => (resolveFirst = r));
        },
      },
    });

    await queue.enqueue(op('a'));
    await vi.waitFor(() => expect(calls).toBe(1));
    await queue.enqueue(op('b'));

    // Confirming the first batch must trim only its own prefix — truncating the
    // whole file here would discard `b`, which nothing has delivered yet.
    resolveFirst();
    await queue.drain();

    await expect(fs.readFile(logPath, 'utf8')).rejects.toThrow();
    expect(calls).toBe(2);
  });
});
