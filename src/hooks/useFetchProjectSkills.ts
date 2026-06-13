import { type ListProjectSkillsResult } from '@lobechat/electron-client-ipc';

import { useClientDataSWR } from '@/libs/swr';
import { projectSkillService } from '@/services/projectSkill';

/**
 * Shared SWR fetch for filesystem-backed project skills under `.agents/skills/`
 * / `.claude/skills/` in a working directory.
 *
 * `deviceId` picks the transport: a bound device scans over the
 * `device.listProjectSkills` RPC, the local desktop reads over Electron IPC. The
 * SWR key is stable across callers (the `/` slash menu and the SkillsList UI
 * hook), so they dedupe a single fetch. Pass `undefined` workingDirectory to
 * keep the hook inert — no fetch fires.
 */
export const useFetchProjectSkills = (workingDirectory: string | undefined, deviceId?: string) =>
  useClientDataSWR<ListProjectSkillsResult | undefined>(
    workingDirectory ? ['project-skills', deviceId ?? 'local', workingDirectory] : null,
    () => projectSkillService.listProjectSkills({ deviceId, scope: workingDirectory! }),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
