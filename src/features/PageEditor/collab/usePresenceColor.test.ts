import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { getPresenceColor, PRESENCE_COLORS } from './presence';
import { usePresenceColor } from './usePresenceColor';

const SELF_ID = 10;

const createAwareness = () => {
  const listeners = new Set<() => void>();
  const remote = new Map<number, any>();
  let local: any = {
    awarenessData: { joinedAt: 100, userId: 'me' },
    color: getPresenceColor('me'),
    name: 'Me',
  };
  const emit = () => listeners.forEach((listener) => listener());

  return {
    getLocalState: () => local,
    getStates: () => new Map([...remote, [SELF_ID, local]]),
    off: (_: 'update', listener: () => void) => listeners.delete(listener),
    on: (_: 'update', listener: () => void) => listeners.add(listener),
    setLocalState: (state: any) => {
      local = state;
      emit();
    },
    setRemote: (clientId: number, state: any) => {
      remote.set(clientId, state);
      emit();
    },
  };
};

const nextColor = (color: string) =>
  PRESENCE_COLORS[(PRESENCE_COLORS.indexOf(color) + 1) % PRESENCE_COLORS.length];

describe('usePresenceColor', () => {
  it('moves its broadcast color when an earlier joiner on the page already has it', () => {
    const awareness = createAwareness();
    const preferred = getPresenceColor('me');
    renderHook(() =>
      usePresenceColor({
        awareness,
        clientId: SELF_ID,
        getCursors: () => undefined,
        joinedAt: 100,
        userId: 'me',
      }),
    );

    awareness.setRemote(2, {
      awarenessData: { joinedAt: 50, userId: 'lin' },
      color: preferred,
      name: 'Lin Wei',
    });

    expect(awareness.getLocalState().color).toBe(nextColor(preferred));
  });

  it('redraws a remote cursor after its owner changes color', () => {
    const awareness = createAwareness();
    const cursors = new Map([[2, { color: '#111', selection: null }]]);
    renderHook(() =>
      usePresenceColor({
        awareness,
        clientId: SELF_ID,
        getCursors: () => cursors,
        joinedAt: 100,
        userId: 'me',
      }),
    );

    awareness.setRemote(2, {
      awarenessData: { joinedAt: 200, userId: 'lin' },
      color: '#222',
      name: 'Lin Wei',
    });

    expect(cursors.has(2)).toBe(false);
  });

  it('stops listening once unmounted', () => {
    const awareness = createAwareness();
    const preferred = getPresenceColor('me');
    const { unmount } = renderHook(() =>
      usePresenceColor({
        awareness,
        clientId: SELF_ID,
        getCursors: () => undefined,
        joinedAt: 100,
        userId: 'me',
      }),
    );

    unmount();
    awareness.setRemote(2, {
      awarenessData: { joinedAt: 50, userId: 'lin' },
      color: preferred,
      name: 'Lin Wei',
    });

    expect(awareness.getLocalState().color).toBe(preferred);
  });
});
