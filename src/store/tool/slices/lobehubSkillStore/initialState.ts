import { type LobehubSkillServer } from './types';

/**
 * LobeHub Skill Store state interface
 *
 * NOTE: All connection states and tool data are fetched in real-time from Market API, not stored in local database
 */
export interface LobehubSkillStoreState {
  /** Set of executing tool call IDs */
  lobehubSkillExecutingToolIds: Set<string>;
  /** Set of loading Provider IDs */
  lobehubSkillLoadingIds: Set<string>;
  /** List of connected LobeHub Skill Servers */
  lobehubSkillServers: LobehubSkillServer[];
}

/**
 * LobeHub Skill Store initial state
 */
export const initialLobehubSkillStoreState: LobehubSkillStoreState = {
  lobehubSkillExecutingToolIds: new Set(),
  lobehubSkillLoadingIds: new Set(),
  lobehubSkillServers: [],
};
