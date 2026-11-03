import { type SessionStore } from '@/store/session';
import { type LobeAgentSession } from '@/types/session';
import { LobeSessionType } from '@/types/session';

import { sessionSelectors } from './list';

describe('currentSession', () => {
  const s = {
    activeId: '1',
    sessions: [
      {
        id: '1',
        config: {
          model: 'gpt-3.5-turbo',
          params: {},
          systemRole: 'system-role',
        },
        type: LobeSessionType.Agent,
      } as LobeAgentSession,
      {
        id: '2',
        config: {
          model: 'gpt-3.5-turbo',
          params: {},
          systemRole: 'system-role',
        },
        type: LobeSessionType.Agent,
      } as LobeAgentSession,
    ],
  } as unknown as SessionStore;

  it('should return undefined when s.activeId is not defined', () => {
    expect(sessionSelectors.currentSession({ sessions: {} } as any)).toBeUndefined();
  });

  it('should return s.sessions[s.activeId] when s.activeId is not equal to INBOX_SESSION_ID', () => {
    expect(sessionSelectors.currentSession(s)).toEqual(s.sessions[0]);
  });
});

describe('getSessionById', () => {
  const s = {
    activeId: '1',
    sessions: [
      {
        id: '1',
        config: {
          model: 'gpt-3.5-turbo',
          params: {},
          systemRole: 'system-role',
        },
        type: LobeSessionType.Agent,
      } as LobeAgentSession,
      {
        id: '2',
        config: {
          model: 'gpt-3.5-turbo',
          params: {},
          systemRole: 'system-role',
        },
        type: LobeSessionType.Agent,
      } as LobeAgentSession,
    ],
  } as unknown as SessionStore;

  it('should return the session with the specified id when id is not equal to INBOX_SESSION_ID', () => {
    expect(sessionSelectors.getSessionById('1')(s)).toEqual(s.sessions[0]);
  });
});
