import { type UIChatMessage } from '@lobechat/types';
import { act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createStore } from '../../index';

vi.mock('@lobechat/conversation-flow', () => ({
  parse: (messages: UIChatMessage[]) => ({
    flatList: [...messages].sort((a, b) => a.createdAt - b.createdAt),
    messageMap: Object.fromEntries(messages.map((m) => [m.id, m])),
  }),
}));

const base = { content: '', updatedAt: 0 };
const steered = [
  { ...base, createdAt: 1, id: 'u1', role: 'user' },
  { ...base, children: [], createdAt: 2, id: 'g1', role: 'assistantGroup' },
  { ...base, createdAt: 3, id: 's1', metadata: { steer: true }, role: 'user' },
  { ...base, children: [], createdAt: 4, id: 'g2', role: 'assistantGroup' },
  { ...base, createdAt: 5, id: 'u2', role: 'user' },
] as UIChatMessage[];

const createSteeredStore = () => {
  const store = createStore({ context: { agentId: 'agent', threadId: null, topicId: null } });
  act(() => {
    store.getState().replaceMessages(steered);
  });
  return store;
};

describe('selection actions', () => {
  it('selectToHere stores row ids only, never folded steer members', () => {
    const store = createSteeredStore();

    act(() => {
      store.getState().selectToHere('s1');
    });

    expect(store.getState().selectedMessageIds).toEqual(['u1', 'g1']);
  });

  it('selectRange skips folded steer members between the anchor and the target', () => {
    const store = createSteeredStore();

    act(() => {
      store.getState().enterSelectionMode('u1');
      store.getState().selectRange('u2');
    });

    expect(store.getState().selectedMessageIds).toEqual(['u1', 'g1', 'u2']);
  });
});
