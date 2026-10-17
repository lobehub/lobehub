import type { ListProjectSkillsResult } from '@lobechat/electron-client-ipc';

import { createReplicaState, type ReplicaState } from '@/libs/replica';

export interface ProjectSkillsState {
  /** Filesystem skill scans, keyed by `projectSkillsKey({ deviceId, workingDirectory })`. */
  projectSkillsMap: Record<string, ListProjectSkillsResult>;
  /** Replica bookkeeping for `projectSkillsMap`. */
  projectSkillsReplica: ReplicaState<ListProjectSkillsResult>;
}

export const initialProjectSkillsState: ProjectSkillsState = {
  projectSkillsMap: {},
  projectSkillsReplica: createReplicaState(),
};
