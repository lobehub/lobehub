import { nanoid } from 'nanoid';
import { describe, expect, it } from 'vitest';

import { type LobeSessions } from '@/types/session';

import { type SessionDispatch } from './reducers';
import { sessionsReducer } from './reducers';

describe('sessionsReducer', () => {
  const mockSession = {
    id: nanoid(),
    config: {
      model: 'gpt-3.5-turbo',
    } as any,
    meta: {
      title: 'Test Agent',
      description: 'A test agent',
      avatar: '',
    },
  } as any;

  const initialState: LobeSessions = [];

  it('should add a new session', () => {
    const addAction: SessionDispatch = {
      session: mockSession,
      type: 'addSession',
    };

    const newState = sessionsReducer(initialState, addAction);

    expect(newState).toHaveLength(1);
    expect(newState[0]).toMatchObject({
      ...mockSession,
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
    });
  });

  it('should remove an existing session', () => {
    const state: LobeSessions = [mockSession];
    const removeAction: SessionDispatch = {
      id: mockSession.id,
      type: 'removeSession',
    };

    const newState = sessionsReducer(state, removeAction);

    expect(newState).toHaveLength(0);
  });

  it('should update an existing session', () => {
    const state: LobeSessions = [mockSession];
    const updateAction: SessionDispatch = {
      id: mockSession.id,
      type: 'updateSession',
      value: { group: 'abc' },
    };

    const newState = sessionsReducer(state, updateAction);

    expect(newState).toHaveLength(1);
    expect(newState[0]).toMatchObject({
      ...mockSession,
      group: 'abc',
      updatedAt: expect.any(Date),
    });
  });

  it('should return the same state for unknown action', () => {
    const state: LobeSessions = [mockSession];
    // @ts-ignore
    const unknownAction: SessionDispatch = { type: 'unknown' };

    const newState = sessionsReducer(state, unknownAction);

    expect(newState).toEqual(state);
  });
});
