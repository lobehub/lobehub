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
    queue.enqueue(op('a'));
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

    queue.enqueue(op('a'));
    await vi.waitFor(() => expect(batches).toHaveLength(1));

    // Three more arrive mid-flight; they should ship as ONE follow-up batch,
    // not three round trips queued behind each other.
    queue.enqueue(op('b'));
    queue.enqueue(op('c'));
    queue.enqueue(op('d'));
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

    queue.enqueue(op('a'));
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
    dying.enqueue(op('a'));
    dying.enqueue(op('b'));
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

    queue.enqueue(op('a'));
    await vi.waitFor(() => expect(calls).toBe(1));
    queue.enqueue(op('b'));

    // Confirming the first batch must trim only its own prefix — truncating the
    // whole file here would discard `b`, which nothing has delivered yet.
    resolveFirst();
    await queue.drain();

    await expect(fs.readFile(logPath, 'utf8')).rejects.toThrow();
    expect(calls).toBe(2);
  });
});
