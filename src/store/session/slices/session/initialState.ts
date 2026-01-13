import { type LobeSessions } from '@/types/session';

export interface SessionState {
  activeAgentId?: string;
  /**
   * @title 当前活动的会话
   * @description 当前正在编辑或查看的会话
   */
  activeId: string;
  /**
   * whether all agents drawer is open
   */
  allAgentsDrawerOpen: boolean;
  defaultSessions: LobeSessions;
  /**
   * @title Whether the agent panel is pinned
   * @description Controls the agent panel pinning state in the UI layout
   */
  isAgentPinned: boolean;
  isSearching: boolean;
  isSessionsFirstFetchFinished: boolean;
  pinnedSessions: LobeSessions;
  searchKeywords: string;
  /**
   * @title 正在重命名的会话 ID
   * @description 用于控制会话重命名弹窗的显示状态
   */
  sessionRenamingId: string | null;
  sessionSearchKeywords?: string;
  /**
   * @title 正在更新的会话 ID
   * @description 用于显示会话更新时的加载状态
   */
  sessionUpdatingId: string | null;
  /**
   * it means defaultSessions
   */
  sessions: LobeSessions;
}

export const initialSessionState: SessionState = {
  activeId: 'inbox',
  allAgentsDrawerOpen: false,
  defaultSessions: [],
  isAgentPinned: false,
  isSearching: false,
  isSessionsFirstFetchFinished: false,
  pinnedSessions: [],
  searchKeywords: '',
  sessionRenamingId: null,
  sessionUpdatingId: null,
  sessions: [],
};
