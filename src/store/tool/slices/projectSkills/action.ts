import type { ListProjectSkillsResult } from '@lobechat/electron-client-ipc';

import { createReplicaSlice, recordLens, type ReplicaSyncResult } from '@/libs/replica';
import { projectSkillService } from '@/services/projectSkill';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { type ToolStore } from '../../store';
import { EMPTY_PROJECT_SKILLS, projectSkillsResource } from './projection';

const n = setNamespace('projectSkills');

type Setter = StoreSetter<ToolStore>;

export const createProjectSkillsSlice = (set: Setter, get: () => ToolStore, _api?: unknown) =>
  new ProjectSkillsActionImpl(set, get, _api);

export class ProjectSkillsActionImpl {
  readonly #skills;

  constructor(set: Setter, get: () => ToolStore, _api?: unknown) {
    void _api;
    this.#skills = createReplicaSlice(projectSkillsResource, {
      actionPrefix: n('projectSkills'),
      // A host without a scanner answers `undefined`; settle it as an empty scan
      // so the entry stops reading as loading.
      fetcher: async ({ deviceId, workingDirectory }) =>
        (await projectSkillService.listProjectSkills({ deviceId, scope: workingDirectory })) ??
        EMPTY_PROJECT_SKILLS,
      get,
      set,
      stateKey: 'projectSkillsReplica',
      view: recordLens<ToolStore, ListProjectSkillsResult>('projectSkillsMap'),
    });
  }

  /**
   * Scan the project and execution-device skills of one device + directory,
   * shared by the `/` slash menu and the working-sidebar Skills section. A bound
   * `deviceId` scans over the `device.listProjectSkills` RPC, the local desktop
   * over Electron IPC. Pass `undefined` workingDirectory to keep it inert. Read
   * the scan with `projectSkillsSelectors`, not from the return value.
   */
  useFetchProjectSkills = (
    workingDirectory: string | undefined,
    deviceId?: string,
  ): ReplicaSyncResult =>
    this.#skills.useSync(workingDirectory ? { deviceId, workingDirectory } : null, {
      // Remote skills live on a device this client can't watch for filesystem
      // changes, so refetch on focus to pick up edits made on the device. The
      // local IPC path stays off-focus — the desktop already sees its own
      // filesystem.
      revalidateOnFocus: !!deviceId,
    });
}

export type ProjectSkillsAction = Pick<ProjectSkillsActionImpl, keyof ProjectSkillsActionImpl>;
