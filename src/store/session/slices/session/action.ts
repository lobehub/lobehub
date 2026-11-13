import { type PartialDeep } from 'type-fest';

import { DEFAULT_AGENT_LOBE_SESSION } from '@/const/session';
import { analyticsClient } from '@/libs/analytics/client';
import { chatGroupService } from '@/services/chatGroup';
import { sessionService } from '@/services/session';
import { type SessionStore } from '@/store/session';
import { type StoreSetter } from '@/store/types';
import { getUserStoreState, useUserStore } from '@/store/user';
import { settingsSelectors, userProfileSelectors } from '@/store/user/selectors';
import {
  type LobeAgentSession,
  type LobeSessionGroups,
  type LobeSessions,
  type UpdateSessionParams,
} from '@/types/session';
import { LobeSessionType } from '@/types/session';
import { merge } from '@/utils/merge';
import { setNamespace } from '@/utils/storeDebug';

import { type SessionDispatch } from './reducers';
import { sessionsReducer } from './reducers';
import { sessionSelectors } from './selectors';

const n = setNamespace('session');

type Setter = StoreSetter<SessionStore>;
export const createSessionSlice = (set: Setter, get: () => SessionStore, _api?: unknown) =>
  new SessionActionImpl(set, get, _api);

export class SessionActionImpl {
  readonly #get: () => SessionStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => SessionStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  closeAllAgentsDrawer = (): void => {
    this.#set({ allAgentsDrawerOpen: false }, false, n('closeAllAgentsDrawer'));
  };

  /** @deprecated Use agentStore.createAgent instead */
  createSession = async (
    agent?: PartialDeep<LobeAgentSession>,
    isSwitchSession: boolean = true,
  ): Promise<string> => {
    const { switchSession } = this.#get();

    // merge the defaultAgent in settings
    const defaultAgent = merge(
      DEFAULT_AGENT_LOBE_SESSION,
      settingsSelectors.defaultAgent(useUserStore.getState()),
    );

    const newSession: LobeAgentSession = merge(defaultAgent, agent);

    const id = await sessionService.createSession(LobeSessionType.Agent, newSession);

    const userId = userProfileSelectors.userId(getUserStoreState());

    void analyticsClient.track({
      name: 'new_agent_created',
      properties: {
        assistant_name: newSession.meta?.title || 'Untitled Agent',
        assistant_tags: newSession.meta?.tags || [],
        session_id: id,
        user_id: userId || 'anonymous',
      },
    });

    // Whether to goto  to the new session after creation, the default is to switch to
    if (isSwitchSession) switchSession(id);

    return id;
  };

  openAllAgentsDrawer = (): void => {
    this.#set({ allAgentsDrawerOpen: true }, false, n('openAllAgentsDrawer'));
  };

  pinSession = async (id: string, pinned: boolean): Promise<void> => {
    await this.#get().internal_updateSession(id, { pinned });
  };

  setAgentPinned = (value: boolean | ((prev: boolean) => boolean)): void => {
    this.#set(
      (state) => ({
        isAgentPinned: typeof value === 'function' ? value(state.isAgentPinned) : value,
      }),
      false,
      n('setAgentPinned'),
    );
  };

  switchSession = (sessionId: string): void => {
    if (this.#get().activeAgentId === sessionId) return;

    this.#set({ activeAgentId: sessionId }, false, n(`activeSession/${sessionId}`));
  };

  toggleAgentPinned = (): void => {
    this.#set((state) => ({ isAgentPinned: !state.isAgentPinned }), false, n('toggleAgentPinned'));
  };

  triggerSessionUpdate = async (id: string): Promise<void> => {
    await this.#get().internal_updateSession(id, { updatedAt: new Date() });
  };

  updateSearchKeywords = (keywords: string): void => {
    this.#set(
      { isSearching: !!keywords, sessionSearchKeywords: keywords },
      false,
      n('updateSearchKeywords'),
    );
  };

  updateSessionGroupId = async (sessionId: string, group: string): Promise<void> => {
    const session = sessionSelectors.getSessionById(sessionId)(this.#get());

    if (session?.type === 'group') {
      // For group sessions (chat groups), use the chat group service
      await chatGroupService.updateGroup(sessionId, {
        groupId: group === 'default' ? null : group,
      });
    } else {
      // For regular agent sessions, use the existing session service
      await this.#get().internal_updateSession(sessionId, { group });
    }
  };

  internal_dispatchSessions = (payload: SessionDispatch): void => {
    const nextSessions = sessionsReducer(this.#get().sessions, payload);
    this.#get().internal_processSessions(nextSessions, this.#get().sessionGroups);
  };

  internal_updateSession = async (
    id: string,
    data: Partial<UpdateSessionParams>,
  ): Promise<void> => {
    this.#get().internal_dispatchSessions({ id, type: 'updateSession', value: data });

    await sessionService.updateSession(id, data);
  };

  internal_processSessions = (sessions: LobeSessions, sessionGroups: LobeSessionGroups): void => {
    const customGroups = sessionGroups.map((item) => ({
      ...item,
      children: sessions.filter((i) => i.group === item.id && !i.pinned),
    }));

    const defaultGroup = sessions.filter(
      (item) => (!item.group || item.group === 'default') && !item.pinned,
    );
    const pinnedGroup = sessions.filter((item) => item.pinned);

    this.#set(
      {
        customSessionGroups: customGroups,
        defaultSessions: defaultGroup,
        pinnedSessions: pinnedGroup,
        sessionGroups,
        sessions,
      },
      false,
      n('processSessions'),
    );
  };
}

export type SessionAction = Pick<SessionActionImpl, keyof SessionActionImpl>;
