import type { GitWorkingTreeFiles, ProjectFileIndexResult } from '@lobechat/electron-client-ipc';

import { createReplicaState, type ReplicaState } from '@/libs/replica';

import type { FilesLocation } from './projection';

export interface ProjectFileState {
  /** Last Files tab location, by conversation (`filesLocationResource` key). */
  filesLocation: Record<string, FilesLocation>;
  filesLocationReplica: ReplicaState<FilesLocation>;
  /** Git dirty-file overlays, by `gitWorkingTreeFilesResource` key. */
  gitWorkingTreeFiles: Record<string, GitWorkingTreeFiles>;
  gitWorkingTreeFilesReplica: ReplicaState<GitWorkingTreeFiles>;
  /** Project trees, by `projectIndexResource` key. */
  projectIndex: Record<string, ProjectFileIndexResult>;
  projectIndexReplica: ReplicaState<ProjectFileIndexResult>;
}

export const initialProjectFileState: ProjectFileState = {
  filesLocation: {},
  filesLocationReplica: createReplicaState(),
  gitWorkingTreeFiles: {},
  gitWorkingTreeFilesReplica: createReplicaState(),
  projectIndex: {},
  projectIndexReplica: createReplicaState(),
};
