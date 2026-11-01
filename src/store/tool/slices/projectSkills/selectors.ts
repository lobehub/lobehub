import type { ListProjectSkillsResult } from '@lobechat/electron-client-ipc';

import type { ToolStoreState } from '../../initialState';
import { projectSkillsKey } from './projection';

/** The scan of one device + directory; `undefined` until it is hydrated or fetched. */
const getProjectSkills =
  (workingDirectory: string | undefined, deviceId?: string) =>
  (s: ToolStoreState): ListProjectSkillsResult | undefined =>
    workingDirectory
      ? s.projectSkillsMap[projectSkillsKey({ deviceId, workingDirectory })]
      : undefined;

export const projectSkillsSelectors = {
  getProjectSkills,
};
