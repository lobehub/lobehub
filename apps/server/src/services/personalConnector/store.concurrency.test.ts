import { describe, expect, it } from 'vitest';

import { agents, userConnectors } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { DatabasePersonalConnectionStore } from './store';

const connection = (id: string, managed: boolean) => ({
  id,
  identifier: 'gmail',
  isEnabled: true,
  metadata: managed
    ? { nativeAccess: { agentIds: ['agent-0'], readToolNames: ['GMAIL_FETCH_EMAILS'] } }
    : null,
  status: 'connected',
  updatedAt: new Date(0),
  userId: 'owner',
});

describe('personal connection query backpressure', () => {
  it('bounds concurrent database reads while listing many connections', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => connection(`connection-${i}`, true));
    let active = 0;
    let peak = 0;
    const db = {
      select: () => ({
        from: (table: unknown) => ({
          where: async () => {
            if (table === userConnectors) return rows;
            expect(table).toBe(agents);
            peak = Math.max(peak, ++active);
            await new Promise((resolve) => setTimeout(resolve, 0));
            active--;
            return [{ id: 'agent-0', plugins: [] }];
          },
        }),
      }),
    } as unknown as LobeChatDatabase;

    const listed = await new DatabasePersonalConnectionStore(db, 'owner', [
      { id: 'gmail', name: 'Gmail' },
    ]).list();

    expect(listed.map((item) => item.id)).toEqual(rows.map((item) => item.id));
    expect(listed.every((item) => item.activeAgentIds.includes('agent-0'))).toBe(true);
    expect(peak).toBeLessThanOrEqual(5);
  });

  it('bounds per-agent account resolution for an existing connection', async () => {
    const row = connection('existing', false);
    const owned = Array.from({ length: 12 }, (_, i) => ({ id: `agent-${i}`, plugins: [] }));
    let active = 0;
    let peak = 0;
    let reads = 0;
    let connectorQueries = 0;
    const db = {
      select: () => ({
        from: (table: unknown) => ({
          where: () => {
            if (table === agents) return Promise.resolve(owned);
            expect(table).toBe(userConnectors);
            if (connectorQueries++ === 0) return { limit: async () => [row] };
            return (async () => {
              reads++;
              peak = Math.max(peak, ++active);
              await new Promise((release) => setTimeout(release, 0));
              active--;
              return [row];
            })();
          },
        }),
      }),
    } as unknown as LobeChatDatabase;

    // The final tool-list read is unrelated to account resolution.
    const originalSelect = db.select.bind(db);
    db.select = ((fields?: unknown) => {
      if (fields && 'name' in (fields as object))
        return { from: () => ({ where: async () => [{ name: 'GMAIL_FETCH_EMAILS' }] }) };
      return originalSelect();
    }) as typeof db.select;
    const projected = await new DatabasePersonalConnectionStore(db, 'owner', [
      { id: 'gmail', name: 'Gmail', readToolNames: ['GMAIL_FETCH_EMAILS'] },
    ]).get(row.id);

    expect(projected?.agentIds).toEqual(owned.map((agent) => agent.id));
    expect(reads).toBe(owned.length);
    expect(peak).toBeLessThanOrEqual(5);
  });
});
