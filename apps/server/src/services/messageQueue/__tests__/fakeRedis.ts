import type Redis from 'ioredis';

import {
  ADOPT_OWNERSHIP_SCRIPT,
  BEGIN_HANDOFF_SCRIPT,
  CANCEL_AND_CLEAR_SCRIPT,
  CLAIM_OR_ENQUEUE_SCRIPT,
  COMMIT_HANDOFF_SCRIPT,
  COMMIT_RECOVERED_CLAIM_SCRIPT,
  FAIL_HANDOFF_SCRIPT,
  INSPECT_AND_REFRESH_SCRIPT,
  RELEASE_OWNED_SCRIPT,
  REMOVE_QUEUED_SCRIPT,
  ROLLBACK_HANDOFF_SCRIPT,
  UPDATE_QUEUED_SCRIPT,
} from '../luaScripts';

interface EvalCall {
  args: Array<number | string>;
  keys: string[];
  script: string;
}

const decodeRows = (rows: string[]): unknown[] => rows.map((row) => JSON.parse(row) as unknown);

/** Small behavioral Redis double for the queue service's exact command surface. */
export class FakeMessageQueueRedis {
  readonly evalCalls: EvalCall[] = [];
  readonly expiries = new Map<string, number>();
  readonly lists = new Map<string, string[]>();
  readonly sets = new Map<string, Set<string>>();
  readonly strings = new Map<string, string>();

  asRedis(): Redis {
    return this as unknown as Redis;
  }

  async get(key: string): Promise<string | null> {
    return this.strings.get(key) ?? null;
  }

  async mget(...keys: string[]): Promise<Array<null | string>> {
    return keys.map((key) => this.strings.get(key) ?? null);
  }

  async lrange(key: string, start: number, end: number): Promise<string[]> {
    const rows = this.lists.get(key) ?? [];
    const normalizedEnd = end < 0 ? rows.length + end : end;
    return rows.slice(start, normalizedEnd + 1);
  }

  async eval(
    script: string,
    keyCount: number,
    ...values: Array<number | string>
  ): Promise<unknown> {
    const keys = values.slice(0, keyCount).map(String);
    const args = values.slice(keyCount);
    this.evalCalls.push({ args, keys, script });

    if (script === CLAIM_OR_ENQUEUE_SCRIPT) return this.claimOrEnqueue(keys, args);
    if (script === COMMIT_RECOVERED_CLAIM_SCRIPT) return this.commitRecoveredClaim(keys, args);
    if (script === ADOPT_OWNERSHIP_SCRIPT) return this.adoptOwnership(keys, args);
    if (script === INSPECT_AND_REFRESH_SCRIPT) return this.inspectAndRefresh(keys, args);
    if (script === BEGIN_HANDOFF_SCRIPT) return this.beginHandoff(keys, args);
    if (script === COMMIT_HANDOFF_SCRIPT) return this.commitHandoff(keys, args);
    if (script === FAIL_HANDOFF_SCRIPT) return this.failHandoff(keys, args);
    if (script === ROLLBACK_HANDOFF_SCRIPT) return this.rollbackHandoff(keys, args);
    if (script === RELEASE_OWNED_SCRIPT) return this.releaseOwned(keys, args);
    if (script === REMOVE_QUEUED_SCRIPT) return this.removeQueued(keys, args);
    if (script === UPDATE_QUEUED_SCRIPT) return this.updateQueued(keys, args);
    if (script === CANCEL_AND_CLEAR_SCRIPT) return this.cancelAndClear(keys, args);

    throw new Error('Unexpected Lua script');
  }

  private setExpiry(key: string, ttl: number | string): void {
    this.expiries.set(key, Number(ttl));
  }

  private adoptOwnership(keys: string[], args: Array<number | string>): number {
    const [activeKey, nextReverseKey, contextKey, oldReverseKey, queueKey, dedupKey] = keys;
    const [contextId, nextOperationId, expectedOldOperationId, contextRaw] = args;
    const active = this.strings.get(activeKey);

    if (active === nextOperationId) {
      if (this.strings.get(nextReverseKey) !== contextId) return 0;
    } else if (active) {
      if (!expectedOldOperationId || active !== expectedOldOperationId) return 0;
      if (this.strings.get(oldReverseKey) !== contextId) return 0;
      this.strings.delete(oldReverseKey);
    } else if (expectedOldOperationId && this.strings.get(oldReverseKey) === contextId) {
      this.strings.delete(oldReverseKey);
    }

    this.strings.set(activeKey, String(nextOperationId));
    this.strings.set(nextReverseKey, String(contextId));
    this.strings.set(contextKey, String(contextRaw));
    this.setExpiry(activeKey, args[4]);
    this.setExpiry(contextKey, args[5]);
    this.setExpiry(queueKey, args[5]);
    this.setExpiry(dedupKey, args[6]);
    this.setExpiry(nextReverseKey, args[7]);
    return 1;
  }

  private claimOrEnqueue(keys: string[], args: Array<number | string>): string {
    const [activeKey, queueKey, dedupKey, reverseKey, contextKey, inflightKey] = keys;
    const [messageRaw, messageId, proposedOperationId, contextId, contextRaw, maxLength] = args;
    const dedup = this.sets.get(dedupKey) ?? new Set<string>();
    this.sets.set(dedupKey, dedup);
    const activeOperationId = this.strings.get(activeKey);
    const duplicate = dedup.has(String(messageId));

    if (!activeOperationId) {
      const backlog = this.lists.get(queueKey) ?? [];
      if (backlog.length === 0 && duplicate) {
        return JSON.stringify({
          activeOperationId: '',
          decision: 'duplicate',
          queueId: messageId,
        });
      }

      this.strings.set(activeKey, String(proposedOperationId));
      this.strings.set(reverseKey, String(contextId));
      this.strings.set(contextKey, String(contextRaw));
      dedup.add(String(messageId));
      this.setExpiry(activeKey, args[6]);
      this.setExpiry(queueKey, args[7]);
      this.setExpiry(dedupKey, args[8]);
      this.setExpiry(reverseKey, args[9]);
      if (backlog.length > 0) {
        if (!duplicate) backlog.push(String(messageRaw));
        this.lists.delete(queueKey);
        this.lists.set(inflightKey, backlog);
        this.setExpiry(inflightKey, args[7]);
        return JSON.stringify({
          activeOperationId: proposedOperationId,
          decision: 'proceed',
          queueId: messageId,
          recoveredItems: decodeRows(backlog),
        });
      }
      return JSON.stringify({
        activeOperationId: proposedOperationId,
        decision: 'proceed',
        queueId: messageId,
      });
    }

    if (duplicate) {
      return JSON.stringify({
        activeOperationId,
        decision: 'duplicate',
        queueId: messageId,
      });
    }

    const queue = this.lists.get(queueKey) ?? [];
    if (queue.length >= Number(maxLength)) {
      return JSON.stringify({
        activeOperationId,
        decision: 'rejected',
        queueId: messageId,
      });
    }

    queue.push(String(messageRaw));
    this.lists.set(queueKey, queue);
    dedup.add(String(messageId));
    this.setExpiry(activeKey, args[6]);
    this.setExpiry(queueKey, args[7]);
    this.setExpiry(dedupKey, args[8]);
    return JSON.stringify({ activeOperationId, decision: 'queued', queueId: messageId });
  }

  private commitRecoveredClaim(keys: string[], args: Array<number | string>): number {
    if (this.strings.get(keys[0]) !== args[0]) return 0;
    if (this.strings.get(keys[1]) !== args[1]) return 0;
    if (this.strings.has(keys[3])) return 0;
    this.lists.delete(keys[2]);
    return 1;
  }

  private inspectAndRefresh(keys: string[], args: Array<number | string>): string {
    const [activeKey, queueKey, dedupKey, reverseKey, contextKey] = keys;
    const [operationId, contextId] = args;
    if (this.strings.get(reverseKey) !== contextId) return '';
    if (this.strings.get(activeKey) !== operationId) return '';
    const contextRaw = this.strings.get(contextKey);
    if (!contextRaw) return '';

    this.setExpiry(activeKey, args[2]);
    this.setExpiry(queueKey, args[3]);
    this.setExpiry(dedupKey, args[4]);
    this.setExpiry(reverseKey, args[5]);
    return JSON.stringify({
      context: JSON.parse(contextRaw) as unknown,
      hasPending: (this.lists.get(queueKey)?.length ?? 0) > 0,
    });
  }

  private beginHandoff(keys: string[], args: Array<number | string>): string {
    const [
      activeKey,
      queueKey,
      inflightKey,
      dedupKey,
      oldReverseKey,
      nextReverseKey,
      contextKey,
      receiptKey,
      pointerKey,
    ] = keys;
    const [oldOperationId, nextOperationId, contextId] = args;
    const existingRaw = this.strings.get(receiptKey);
    if (existingRaw) {
      return JSON.stringify({
        items: decodeRows(this.lists.get(inflightKey) ?? []),
        receipt: JSON.parse(existingRaw) as unknown,
      });
    }
    if (
      this.strings.get(oldReverseKey) !== contextId ||
      this.strings.get(activeKey) !== oldOperationId
    ) {
      return JSON.stringify({ code: 'not_owner' });
    }

    const queued = this.lists.get(queueKey) ?? [];
    if (queued.length === 0) return JSON.stringify({ code: 'no_pending' });
    const contextRaw = this.strings.get(contextKey);
    if (!contextRaw) return JSON.stringify({ code: 'missing_context' });

    this.lists.delete(queueKey);
    this.lists.set(inflightKey, [...queued]);
    const items = decodeRows(queued) as Array<{ id: string }>;
    const receipt = {
      consumedQueueIds: items.map((item) => item.id),
      context: JSON.parse(contextRaw) as unknown,
      nextOperationId,
      oldOperationId,
      status: 'pending',
    };
    this.strings.set(activeKey, String(nextOperationId));
    this.strings.set(nextReverseKey, String(contextId));
    this.strings.set(pointerKey, String(oldOperationId));
    this.strings.set(receiptKey, JSON.stringify(receipt));
    this.setExpiry(activeKey, args[3]);
    this.setExpiry(inflightKey, args[4]);
    this.setExpiry(dedupKey, args[5]);
    this.setExpiry(oldReverseKey, args[6]);
    this.setExpiry(nextReverseKey, args[6]);
    this.setExpiry(receiptKey, args[7]);
    return JSON.stringify({ items, receipt });
  }

  private commitHandoff(keys: string[], args: Array<number | string>): number {
    const [activeKey, inflightKey, oldReverseKey, nextReverseKey, receiptKey, queueKey] = keys;
    const receiptRaw = this.strings.get(receiptKey);
    if (!receiptRaw) return 0;
    const receipt = JSON.parse(receiptRaw) as Record<string, unknown>;
    if (receipt.nextOperationId !== args[1]) return 0;
    if (receipt.status === 'committed') return 1;
    if (receipt.status !== 'pending') return 0;
    receipt.status = 'committed';
    receipt.nextOperation = JSON.parse(String(args[2])) as unknown;
    this.strings.set(receiptKey, JSON.stringify(receipt));
    this.lists.delete(inflightKey);
    this.strings.delete(oldReverseKey);
    this.strings.delete(keys[8]);
    this.setExpiry(receiptKey, args[7]);
    if (this.strings.get(activeKey) === args[1]) this.setExpiry(activeKey, args[3]);
    this.setExpiry(nextReverseKey, args[6]);
    this.setExpiry(queueKey, args[4]);
    return 1;
  }

  private failHandoff(keys: string[], args: Array<number | string>): number {
    const [activeKey, inflightKey, oldReverseKey, nextReverseKey, receiptKey] = keys;
    const receiptRaw = this.strings.get(receiptKey);
    if (!receiptRaw) return 0;
    const receipt = JSON.parse(receiptRaw) as Record<string, unknown>;
    if (receipt.nextOperationId !== args[1]) return 0;
    if (receipt.status === 'failed') return 1;
    if (receipt.status !== 'pending') return 0;
    receipt.status = 'failed';
    receipt.nextOperation = JSON.parse(String(args[2])) as unknown;
    this.strings.set(receiptKey, JSON.stringify(receipt));
    this.lists.delete(inflightKey);
    this.strings.delete(oldReverseKey);
    this.strings.delete(nextReverseKey);
    this.strings.delete(keys[8]);
    if (this.strings.get(activeKey) === args[1]) this.strings.delete(activeKey);
    this.setExpiry(receiptKey, args[6]);
    return 1;
  }

  private rollbackHandoff(keys: string[], args: Array<number | string>): number {
    const [activeKey, inflightKey, oldReverseKey, nextReverseKey, receiptKey, queueKey] = keys;
    const receiptRaw = this.strings.get(receiptKey);
    if (!receiptRaw) return 0;
    const receipt = JSON.parse(receiptRaw) as Record<string, unknown>;
    if (receipt.nextOperationId !== args[1]) return 0;
    if (receipt.status === 'rolled_back') return 1;
    if (receipt.status !== 'pending') return 0;
    this.lists.set(queueKey, [
      ...(this.lists.get(inflightKey) ?? []),
      ...(this.lists.get(queueKey) ?? []),
    ]);
    this.lists.delete(inflightKey);
    receipt.status = 'rolled_back';
    this.strings.set(receiptKey, JSON.stringify(receipt));
    this.strings.delete(oldReverseKey);
    this.strings.delete(nextReverseKey);
    this.strings.delete(keys[8]);
    if (this.strings.get(activeKey) === args[1]) this.strings.delete(activeKey);
    this.setExpiry(queueKey, args[2]);
    this.setExpiry(receiptKey, args[5]);
    return 1;
  }

  private releaseOwned(keys: string[], args: Array<number | string>): number {
    const [activeKey, queueKey, dedupKey, reverseKey, contextKey, inflightKey, pointerKey] = keys;
    if (this.strings.get(reverseKey) !== args[1]) return 0;
    if (this.strings.get(activeKey) !== args[0]) return 0;
    this.strings.delete(activeKey);
    this.strings.delete(reverseKey);
    if (args[2] === '1') {
      const canRestoreInflight = this.lists.has(inflightKey) && !this.strings.has(pointerKey);
      if (canRestoreInflight) {
        if (args[6] === '1') {
          this.lists.delete(inflightKey);
        } else {
          this.lists.set(queueKey, [
            ...(this.lists.get(inflightKey) ?? []),
            ...(this.lists.get(queueKey) ?? []),
          ]);
          this.lists.delete(inflightKey);
        }
      } else if (args[5] !== '' && args[6] !== '1') {
        this.sets.get(dedupKey)?.delete(String(args[5]));
      }
      this.setExpiry(queueKey, args[3]);
      this.setExpiry(dedupKey, args[4]);
      this.setExpiry(contextKey, args[3]);
    } else {
      if (args[5] !== '' && args[6] !== '1') {
        this.sets.get(dedupKey)?.delete(String(args[5]));
      }
      this.lists.delete(queueKey);
      this.sets.delete(dedupKey);
      this.strings.delete(contextKey);
      this.lists.delete(inflightKey);
      this.strings.delete(pointerKey);
    }
    return 1;
  }

  private removeQueued(keys: string[], args: Array<number | string>): string {
    const [queueKey, dedupKey] = keys;
    const rows = this.lists.get(queueKey) ?? [];
    const index = rows.findIndex((row) => {
      const item = JSON.parse(row) as { id: string };
      return item.id === args[0];
    });
    if (index < 0) return '';
    const [removed] = rows.splice(index, 1);
    this.sets.get(dedupKey)?.delete(String(args[0]));
    return removed;
  }

  private updateQueued(keys: string[], args: Array<number | string>): string {
    const rows = this.lists.get(keys[0]) ?? [];
    const index = rows.findIndex((row) => (JSON.parse(row) as { id: string }).id === args[0]);
    if (index < 0) return '';
    const item = JSON.parse(rows[index]) as Record<string, unknown>;
    Object.assign(item, JSON.parse(String(args[1])) as Record<string, unknown>);
    rows[index] = JSON.stringify(item);
    return rows[index];
  }

  private cancelAndClear(keys: string[], args: Array<number | string>): number {
    if ((this.strings.get(keys[0]) ?? '') !== args[0]) return 0;
    if ((this.strings.get(keys[5]) ?? '') !== args[1]) return 0;
    for (const key of keys.slice(0, 6)) {
      this.strings.delete(key);
      this.lists.delete(key);
      this.sets.delete(key);
    }
    if (keys[6]) this.strings.delete(keys[6]);
    if (keys[7]) this.strings.delete(keys[7]);
    return 1;
  }
}
