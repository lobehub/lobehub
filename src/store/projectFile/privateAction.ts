import type { GitWorkingTreeFiles, ProjectFileIndexResult } from '@lobechat/electron-client-ipc';

import { createReplicaSlice, recordLens } from '@/libs/replica';
import { gitService } from '@/services/git';
import { projectFileService } from '@/services/projectFile';
import type { StoreSetter } from '@/store/types';

import { isGitWorkingTreeFilesPersistable } from './codec';
import { type ProjectFileState } from './initialState';
import {
  type FilesLocation,
  filesLocationResource,
  gitWorkingTreeFilesResource,
  projectIndexResource,
} from './projection';

type Setter = StoreSetter<ProjectFileState>;

export class ProjectFilePrivateAction {
  readonly filesLocation;
  readonly gitWorkingTreeFiles;
  readonly projectIndex;

  constructor(set: Setter, get: () => ProjectFileState) {
    this.projectIndex = createReplicaSlice(projectIndexResource, {
      actionPrefix: 'projectFile/projectIndex',
      // An absent result is a terminal "nothing to read there", not a dropped
      // response: the engine skips `isMissing` for `undefined` heads.
      fetcher: async ({ deviceId, dirPath, sandboxInstanceId, sandboxTopicId }) => {
        const result = await projectFileService.getProjectFileIndex({
          deviceId,
          sandboxInstanceId,
          sandboxTopicId,
          scope: dirPath,
        });
        // A remote read that yields nothing is a transport failure, not a
        // confirmed empty directory: the device router collapses offline /
        // timeout to `null`. Throw so the replica keeps its cached tree and
        // exposes the refresh error instead of deleting the saved row.
        if (deviceId && !sandboxInstanceId && !sandboxTopicId && !result) {
          throw new Error('The device did not return a project index');
        }
        return result ?? null;
      },
      get,
      // No tree from the host (nothing to read there) clears the saved one.
      isMissing: (incoming) => incoming === null,
      set,
      stateKey: 'projectIndexReplica',
      view: recordLens<ProjectFileState, ProjectFileIndexResult>('projectIndex'),
    });
    this.gitWorkingTreeFiles = createReplicaSlice(gitWorkingTreeFilesResource, {
      actionPrefix: 'projectFile/gitWorkingTreeFiles',
      fetcher: async ({ deviceId, dirPath }) => {
        const result = await gitService.getGitWorkingTreeFiles({ deviceId, path: dirPath });
        // Same remote contract as the tree: an absent overlay from a device is
        // a transport failure, not a confirmed clean working tree. Throw so a
        // hydrated overlay survives and `gitError` is exposed.
        if (deviceId && !result) {
          throw new Error('The device did not return a git overlay');
        }
        return result ?? null;
      },
      get,
      isMissing: (incoming) => incoming === null,
      set,
      stateKey: 'gitWorkingTreeFilesReplica',
      // An overlay past the cap is not persisted at all — `null` also drops a
      // row (and its bounded-index key) left by an earlier, smaller overlay.
      toPersisted: (data) => (isGitWorkingTreeFilesPersistable(data) ? data : null),
      view: recordLens<ProjectFileState, GitWorkingTreeFiles>('gitWorkingTreeFiles'),
    });
    this.filesLocation = createReplicaSlice(filesLocationResource, {
      actionPrefix: 'projectFile/filesLocation',
      get,
      set,
      stateKey: 'filesLocationReplica',
      view: recordLens<ProjectFileState, FilesLocation>('filesLocation'),
    });
  }
}
