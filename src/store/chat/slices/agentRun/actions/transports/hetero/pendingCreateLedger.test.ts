import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createPendingCreateLedger } from './pendingCreateLedger';

const row = (id: string, parentId?: string) =>
  ({ content: '', id, parentId, role: 'assistant' }) as any;

describe('createPendingCreateLedger', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('ensureParentPersisted', () => {
    it('flushes the write batcher before letting a straight-through write proceed', async () => {
      const flush = vi.fn().mockResolvedValue(undefined);
      const ledger = createPendingCreateLedger({ createMessage: vi.fn(), flush });

      await expect(ledger.ensureParentPersisted('msg-parent')).resolves.toBeUndefined();

      expect(flush).toHaveBeenCalledWith('before-subagent-write');
    });

    /**
     * The gap this ledger exists to close. `flush` resolves even when the create
     * inside it failed — the failure only lands here via `add`. Awaiting the flush
     * is therefore not proof the parent exists, so the ledger replays it.
     */
    it('replays a parent whose batched create failed, then proceeds', async () => {
      const createMessage = vi.fn().mockResolvedValue({ id: 'msg-parent' });
      const flush = vi.fn().mockResolvedValue(undefined);
      const ledger = createPendingCreateLedger({ createMessage, flush });

      // The batcher swallowed this create and reported it through onFailure.
      ledger.add('msg-parent', row('msg-parent'));

      await expect(ledger.ensureParentPersisted('msg-parent')).resolves.toBeUndefined();

      expect(createMessage).toHaveBeenCalledTimes(1);
      expect(ledger.has('msg-parent')).toBe(false);
      expect(ledger.size).toBe(0);
    });

    it('refuses to proceed when the parent still cannot be written', async () => {
      const createMessage = vi.fn().mockRejectedValue(new Error('still failing'));
      const flush = vi.fn().mockResolvedValue(undefined);
      const ledger = createPendingCreateLedger({ createMessage, flush });

      ledger.add('msg-parent', row('msg-parent'));

      // Better to abort the subagent write than to hit the FK error, skip the
      // state commit, and strand another Processing thread on the next retry.
      await expect(ledger.ensureParentPersisted('msg-parent')).rejects.toThrow(
        /missing FK parent msg-parent/,
      );
      expect(ledger.has('msg-parent')).toBe(true);
    });

    it('replays the whole ledger in dependency order, not just the named parent', async () => {
      const written: string[] = [];
      const createMessage = vi.fn().mockImplementation(async (m: any) => void written.push(m.id));
      const ledger = createPendingCreateLedger({
        createMessage,
        flush: vi.fn().mockResolvedValue(undefined),
      });

      // A signal assistant hangs off the run's last TOOL row, which itself hangs
      // off an earlier assistant — replaying only `assistant-2` would violate the FK.
      ledger.add('assistant-1', row('assistant-1'));
      ledger.add('tool-1', row('tool-1', 'assistant-1'));
      ledger.add('assistant-2', row('assistant-2', 'tool-1'));

      await ledger.ensureParentPersisted('assistant-2');

      expect(written).toEqual(['assistant-1', 'tool-1', 'assistant-2']);
    });

    it('does not block on an unrelated row that stays stuck in the ledger', async () => {
      const createMessage = vi.fn().mockRejectedValue(new Error('unrelated row is broken'));
      const ledger = createPendingCreateLedger({
        createMessage,
        flush: vi.fn().mockResolvedValue(undefined),
      });

      ledger.add('some-other-row', row('some-other-row'));

      // `msg-parent` was never in the ledger — it wrote fine through the batcher.
      await expect(ledger.ensureParentPersisted('msg-parent')).resolves.toBeUndefined();
    });

    it('is a no-op when the ledger is empty', async () => {
      const createMessage = vi.fn();
      const ledger = createPendingCreateLedger({
        createMessage,
        flush: vi.fn().mockResolvedValue(undefined),
      });

      await ledger.ensureParentPersisted('msg-parent');
      await ledger.ensureParentPersisted(undefined);

      expect(createMessage).not.toHaveBeenCalled();
    });
  });

  describe('drain', () => {
    it('keeps rows that fail again so a later pass can retry them', async () => {
      const createMessage = vi
        .fn()
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValueOnce({ id: 'msg-b' });
      const ledger = createPendingCreateLedger({
        createMessage,
        flush: vi.fn().mockResolvedValue(undefined),
      });

      ledger.add('msg-a', row('msg-a'));
      ledger.add('msg-b', row('msg-b'));

      await ledger.drain();

      expect(ledger.has('msg-a')).toBe(true);
      expect(ledger.has('msg-b')).toBe(false);
      expect(ledger.size).toBe(1);
    });
  });
});
