import { describe, expect, it } from 'vitest';

import { ServerMessageTransport } from '../adapters/ServerMessageTransport';
import { hasNonPersistedMessage, willHydrateStepEntryMessages } from '../messagePersistence';

describe('hasNonPersistedMessage', () => {
  it('is false when every message has a DB id', () => {
    expect(
      hasNonPersistedMessage([
        { content: 'hi', id: 'm1', role: 'user' },
        { content: 'yo', id: 'm2', role: 'assistant' },
      ]),
    ).toBe(false);
  });

  it('is true when a message has no id (ephemeral / suppressed)', () => {
    expect(
      hasNonPersistedMessage([
        { content: 'persisted', id: 'm1', role: 'user' },
        // group-member supervisor instruction — never written to the DB
        { content: 'respond to the group', role: 'user' },
      ]),
    ).toBe(true);
  });

  it('is false for non-array / empty / nullish inputs', () => {
    expect(hasNonPersistedMessage(undefined)).toBe(false);
    expect(hasNonPersistedMessage(null)).toBe(false);
    expect(hasNonPersistedMessage([])).toBe(false);
    expect(hasNonPersistedMessage('nope')).toBe(false);
  });

  it('ignores malformed entries without a role', () => {
    expect(hasNonPersistedMessage([{ content: 'x' }, null, undefined])).toBe(false);
  });
});

describe('willHydrateStepEntryMessages', () => {
  const origin = { agentId: 'agt_1', topicId: 'tpc_1' };
  const persisted = [{ content: 'hi', id: 'm1', role: 'user' }];

  it('is true for a topic-scoped run whose working set is all DB rows', () => {
    expect(willHydrateStepEntryMessages({ messages: persisted, origin })).toBe(true);
  });

  it('is false without a topic or agent: the step entry read is skipped', () => {
    expect(
      willHydrateStepEntryMessages({ messages: persisted, origin: { agentId: 'agt_1' } }),
    ).toBe(false);
    expect(
      willHydrateStepEntryMessages({ messages: persisted, origin: { topicId: 'tpc_1' } }),
    ).toBe(false);
  });

  it('is false while an ephemeral message is in the working set', () => {
    expect(
      willHydrateStepEntryMessages({
        messages: [...persisted, { content: 'respond to the group', role: 'user' }],
        origin,
      }),
    ).toBe(false);
  });

  it('is what the server message transport reports to the tool executors', () => {
    const transport = new ServerMessageTransport({} as any);
    expect(transport.rehydratesOnNextStep({ messages: persisted, origin } as any)).toBe(true);
    expect(transport.rehydratesOnNextStep({ messages: persisted, origin: {} } as any)).toBe(false);
  });
});
