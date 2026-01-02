import { getSingletonAnalyticsOptional } from '@lobehub/analytics';
import isEqual from 'fast-deep-equal';
import { t } from 'i18next';
import useSWR, { type SWRResponse } from 'swr';
import type { PartialDeep } from 'type-fest';
import { type StateCreator } from 'zustand/vanilla';

import { message } from '@/components/AntdStaticMethods';
import { DEFAULT_AGENT_LOBE_SESSION, INBOX_SESSION_ID } from '@/const/session';
import { DEFAULT_CHAT_GROUP_CHAT_CONFIG } from '@/const/settings';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { chatGroupService } from '@/services/chatGroup';
import { sessionService } from '@/services/session';
import { getChatGroupStoreState } from '@/store/agentGroup';
import { type SessionStore } from '@/store/session';
import { getUserStoreState, useUserStore } from '@/store/user';
import { settingsSelectors, userProfileSelectors } from '@/store/user/selectors';
import {
  type ChatSessionList,
  type LobeAgentSession,
  type LobeSessionGroups,
  LobeSessionType,
  type LobeSessions,
  type UpdateSessionParams,
} from '@/types/session';
import { merge } from '@/utils/merge';
import { setNamespace } from '@/utils/storeDebug';

import { type SessionDispatch, sessionsReducer } from './reducers';
import { sessionSelectors } from './selectors';
import { sessionMetaSelectors } from './selectors/meta';

const n = setNamespace('session');

const FETCH_SESSIONS_KEY = 'fetchSessions';
const SEARCH_SESSIONS_KEY = 'searchSessions';

/* eslint-disable typescript-sort-keys/interface */
export interface SessionAction {
  /**
   * switch the session
   */
  switchSession: (sessionId: string) => void;
  /**
   * reset sessions to default
   */
  clearSessions: () => Promise<void>;
  closeAllAgentsDrawer: () => void;
  /**
   * create a new session
   * @param agent
   * @returns sessionId
   */
  createSession: (
    session?: PartialDeep<LobeAgentSession>,
    isSwitchSession?: boolean,
  ) => Promise<string>;

  duplicateSession: (id: string) => Promise<void>;
  openAllAgentsDrawer: () => void;
  triggerSessionUpdate: (id: string) => Promise<void>;
  updateSessionGroupId: (sessionId: string, groupId: string) => Promise<void>;

  /**
   * Pins or unpins a session.
   */
  pinSession: (id: string, pinned: boolean) => Promise<void>;
  /**
   * re-fetch the data
   */
  refreshSessions: () => Promise<void>;
  /**
   * remove session
   * @param id - sessionId
   */
  removeSession: (id: string) => Promise<void>;

  /**
   * Set the agent panel pinned state
   */
  setAgentPinned: (pinned: boolean | ((prev: boolean) => boolean)) => void;
  /**
   * Toggle the agent panel pinned state
   */
  toggleAgentPinned: () => void;

  updateSearchKeywords: (keywords: string) => void;

  useFetchSessions: (
    enabled: boolean,
    isLogin: boolean | undefined,
  ) => SWRResponse<ChatSessionList>;
  useSearchSessions: (keyword?: string) => SWRResponse<any>;

  internal_dispatchSessions: (payload: SessionDispatch) => void;
  internal_updateSession: (id: string, data: Partial<UpdateSessionParams>) => Promise<void>;
  internal_processSessions: (
    sessions: LobeSessions,
    customGroups: LobeSessionGroups,
    actions?: string,
  ) => void;
  /* eslint-enable */
}

export const createSessionSlice: StateCreator<
  SessionStore,
  [['zustand/devtools', never]],
  [],
  SessionAction
> = (set, get) => ({
  clearSessions: async () => {
    await sessionService.removeAllSessions();
    await get().refreshSessions();
  },

  closeAllAgentsDrawer: () => {
    set({ allAgentsDrawerOpen: false }, false, n('closeAllAgentsDrawer'));
  },

  createSession: async (agent, isSwitchSession = true) => {
    const { switchSession, refreshSessions } = get();

    // merge the defaultAgent in settings
    const defaultAgent = merge(
      DEFAULT_AGENT_LOBE_SESSION,
      settingsSelectors.defaultAgent(useUserStore.getState()),
    );

    const newSession: LobeAgentSession = merge(defaultAgent, agent);

    const id = await sessionService.createSession(LobeSessionType.Agent, newSession);
    await refreshSessions();

    // Track new agent creation analytics
    const analytics = getSingletonAnalyticsOptional();
    if (analytics) {
      const userStore = getUserStoreState();
      const userId = userProfileSelectors.userId(userStore);

      analytics.track({
        name: 'new_agent_created',
        properties: {
          assistant_name: newSession.meta?.title || 'Untitled Agent',
          assistant_tags: newSession.meta?.tags || [],
          session_id: id,
          user_id: userId || 'anonymous',
        },
      });
    }

    // Whether to goto  to the new session after creation, the default is to switch to
    if (isSwitchSession) switchSession(id);

    return id;
  },

  duplicateSession: async (id) => {
    const { switchSession, refreshSessions } = get();
    const session = sessionSelectors.getSessionById(id)(get());

    if (!session) return;
    const title = sessionMetaSelectors.getTitle(session.meta);

    const newTitle = t('duplicateSession.title', { ns: 'chat', title: title });

    const messageLoadingKey = 'duplicateSession.loading';

    message.loading({
      content: t('duplicateSession.loading', { ns: 'chat' }),
      duration: 0,
      key: messageLoadingKey,
    });

    const newId = await sessionService.cloneSession(id, newTitle);

    // duplicate Session Error
    if (!newId) {
      message.destroy(messageLoadingKey);
      message.error(t('copyFail', { ns: 'common' }));
      return;
    }

    await refreshSessions();
    message.destroy(messageLoadingKey);
    message.success(t('duplicateSession.success', { ns: 'chat' }));

    switchSession(newId);
  },

  openAllAgentsDrawer: () => {
    set({ allAgentsDrawerOpen: true }, false, n('openAllAgentsDrawer'));
  },
  pinSession: async (id, pinned) => {
    await get().internal_updateSession(id, { pinned });
  },
  removeSession: async (sessionId) => {
    await sessionService.removeSession(sessionId);
    await get().refreshSessions();

    // If the active session deleted, switch to the inbox session
    if (sessionId === get().activeId) {
      get().switchSession(INBOX_SESSION_ID);
    }
  },

  setAgentPinned: (value) => {
    set(
      (state) => ({
        isAgentPinned: typeof value === 'function' ? value(state.isAgentPinned) : value,
      }),
      false,
      n('setAgentPinned'),
    );
  },

  switchSession: (sessionId) => {
    if (get().activeAgentId === sessionId) return;

    set({ activeAgentId: sessionId }, false, n(`activeSession/${sessionId}`));
  },

  toggleAgentPinned: () => {
    set((state) => ({ isAgentPinned: !state.isAgentPinned }), false, n('toggleAgentPinned'));
  },

  triggerSessionUpdate: async (id) => {
    await get().internal_updateSession(id, { updatedAt: new Date() });
  },

  updateSearchKeywords: (keywords) => {
    set(
      { isSearching: !!keywords, sessionSearchKeywords: keywords },
      false,
      n('updateSearchKeywords'),
    );
  },

  updateSessionGroupId: async (sessionId, group) => {
    const session = sessionSelectors.getSessionById(sessionId)(get());

    if (session?.type === 'group') {
      // For group sessions (chat groups), use the chat group service
      await chatGroupService.updateGroup(sessionId, {
        groupId: group === 'default' ? null : group,
      });
      await get().refreshSessions();
    } else {
      // For regular agent sessions, use the existing session service
      await get().internal_updateSession(sessionId, { group });
    }
  },

  useFetchSessions: (enabled, isLogin) =>
    useClientDataSWR<ChatSessionList>(
      enabled ? [FETCH_SESSIONS_KEY, isLogin] : null,
      () => sessionService.getGroupedSessions(),
      {
        fallbackData: {
          sessionGroups: [],
          sessions: [],
        },
        onSuccess: (data) => {
          if (
            get().isSessionsFirstFetchFinished &&
            isEqual(get().sessions, data.sessions) &&
            isEqual(get().sessionGroups, data.sessionGroups)
          )
            return;

          get().internal_processSessions(
            data.sessions,
            data.sessionGroups,
            n('useFetchSessions/updateData') as any,
          );

          // Sync chat groups from group sessions to chat store
          const groupSessions = data.sessions.filter((session) => session.type === 'group');
          if (groupSessions.length > 0) {
            // For group sessions, we need to transform them to ChatGroupItem format
            // The session ID is the chat group ID, and we can extract basic group info
            const chatGroupStore = getChatGroupStoreState();
            const chatGroups = groupSessions.map((session) => ({
              accessedAt: session.updatedAt,
              clientId: null,
              config: {
                maxResponseInRow: 3,
                orchestratorModel: 'gpt-4',
                orchestratorProvider: 'openai',
                responseOrder: 'sequential' as const,
                responseSpeed: 'medium' as const,
                scene: DEFAULT_CHAT_GROUP_CHAT_CONFIG.scene,
              },
              createdAt: session.createdAt,
              description: session.meta?.description || '',

              groupId: session.group || null,
              id: session.id, // Add the missing groupId property

              // Will be set by the backend
              pinned: session.pinned || false,

              // Session ID is the chat group ID
              slug: null,

              title: session.meta?.title || 'Untitled Group',
              updatedAt: session.updatedAt,
              userId: '', // Use updatedAt as accessedAt fallback
            }));

            chatGroupStore.internal_updateGroupMaps(chatGroups);
          }

          set({ isSessionsFirstFetchFinished: true }, false, n('useFetchSessions/onSuccess', data));
        },
        suspense: true,
      },
    ),
  useSearchSessions: (keyword) =>
    useSWR<LobeSessions>(
      [SEARCH_SESSIONS_KEY, keyword],
      async () => {
        if (!keyword) return [];

        return sessionService.searchSessions(keyword);
      },
      { revalidateOnFocus: false, revalidateOnMount: false },
    ),

  /* eslint-disable sort-keys-fix/sort-keys-fix */
  internal_dispatchSessions: (payload) => {
    const nextSessions = sessionsReducer(get().sessions, payload);
    get().internal_processSessions(nextSessions, get().sessionGroups);
  },
  internal_updateSession: async (id, data) => {
    get().internal_dispatchSessions({ type: 'updateSession', id, value: data });

    await sessionService.updateSession(id, data);
    await get().refreshSessions();
  },
  internal_processSessions: (sessions, sessionGroups) => {
    const customGroups = sessionGroups.map((item) => ({
      ...item,
      children: sessions.filter((i) => i.group === item.id && !i.pinned),
    }));

    const defaultGroup = sessions.filter(
      (item) => (!item.group || item.group === 'default') && !item.pinned,
    );
    const pinnedGroup = sessions.filter((item) => item.pinned);

    set(
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
  },
  refreshSessions: async () => {
    await mutate([FETCH_SESSIONS_KEY, true]);
  },
});
