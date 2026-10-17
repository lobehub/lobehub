import type { GitWorkingTreeFiles, ProjectFileIndexResult } from '@lobechat/electron-client-ipc';
import type { ReplicaSyncOptions } from '@lobechat/replica/zustand';

import type { ReplicaSyncResult } from '@/libs/replica';
import type { StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { initialProjectFileState, type ProjectFileState } from './initialState';
import { ProjectFilePrivateAction } from './privateAction';
import {
  type FilesLocation,
  type FilesLocationParams,
  type GitWorkingTreeFilesParams,
  type ProjectIndexParams,
} from './projection';
import { useProjectFileStore } from './store';

const n = setNamespace('projectFile');

type Setter = StoreSetter<ProjectFileState>;

/** SWR schedule fields the replica driver forwards as is. */
type SyncOptions<TFetched, TData> = ReplicaSyncOptions<TFetched, TData> & {
  shouldRetryOnError?: boolean;
};

export class ProjectFileActionImpl {
  readonly #private: ProjectFilePrivateAction;
  readonly #set: Setter;

  constructor(set: Setter, _get: () => ProjectFileState, privateAction: ProjectFilePrivateAction) {
    void _get;
    this.#set = set;
    this.#private = privateAction;
  }

  /** Remember where a conversation's Files tab settled, for the next cold start. */
  rememberFilesLocation = (contextKey: string, location: FilesLocation): void => {
    this.#private.filesLocation.update(contextKey, () => location);
  };

  reset = (): void => {
    this.#set(initialProjectFileState, false, n('reset'));
  };

  /** Reads the remembered location; there is nothing to fetch. */
  useFetchFilesLocation = (params: FilesLocationParams | null): ReplicaSyncResult =>
    this.#private.filesLocation.useSync(params);

  useFetchGitWorkingTreeFiles = (
    params: GitWorkingTreeFilesParams | null,
    options?: SyncOptions<GitWorkingTreeFiles | null | undefined, GitWorkingTreeFiles>,
  ): ReplicaSyncResult => this.#private.gitWorkingTreeFiles.useSync(params, options);

  useFetchProjectIndex = (
    params: ProjectIndexParams | null,
    options?: SyncOptions<ProjectFileIndexResult | null | undefined, ProjectFileIndexResult>,
  ): ReplicaSyncResult => this.#private.projectIndex.useSync(params, options);
}

const { getState, setState } = useProjectFileStore;

export const projectFileActions = new ProjectFileActionImpl(
  setState,
  getState,
  new ProjectFilePrivateAction(setState, getState),
);
