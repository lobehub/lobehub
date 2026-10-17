import { createReplicaState, type ReplicaState } from '@/libs/replica';

import { type LobehubSkillServer, type LobehubSkillTool } from './types';

/**
 * LobeHub Skill Store state interface
 *
 * NOTE: connection states and tool data are a local-first copy of the Market
 * API — the replica persists them and the network only confirms.
 */
export interface LobehubSkillStoreState {
  /** Set of executing tool call IDs */
  lobehubSkillExecutingToolIds: Set<string>;
  /** Set of loading Provider IDs */
  lobehubSkillLoadingIds: Set<string>;
  /**
   * The connected providers of the active scope — the view of the
   * `lobehubSkillServers` replica. `undefined` until the persisted row hydrates
   * or the first network response lands, so an un-loaded list never reads as an
   * empty one (and the empty default never blocks hydration).
   */
  lobehubSkillServers?: LobehubSkillServer[];
  /** Replica bookkeeping of `lobehubSkillServers`. */
  lobehubSkillServersReplica: ReplicaState<LobehubSkillServer[]>;
  /** Replica view of the provider tool catalogs, one entry per provider id. */
  lobehubSkillToolsMap: Record<string, LobehubSkillTool[]>;
  /** Replica bookkeeping of `lobehubSkillToolsMap`. */
  lobehubSkillToolsReplica: ReplicaState<LobehubSkillTool[]>;
}

/**
 * LobeHub Skill Store initial state
 */
export const initialLobehubSkillStoreState: LobehubSkillStoreState = {
  lobehubSkillExecutingToolIds: new Set(),
  lobehubSkillLoadingIds: new Set(),
  // Absent until the persisted row hydrates or the first network response lands.
  lobehubSkillServers: undefined,
  lobehubSkillServersReplica: createReplicaState(),
  lobehubSkillToolsMap: {},
  lobehubSkillToolsReplica: createReplicaState(),
};
