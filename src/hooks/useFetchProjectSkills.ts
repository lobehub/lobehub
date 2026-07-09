import { type ListProjectSkillsResult } from '@lobechat/electron-client-ipc';

import { useClientDataSWR } from '@/libs/swr';
import { projectSkillService } from '@/services/projectSkill';

/**
 * Shared SWR fetch for filesystem-backed project and device skills.
 *
 * `deviceId` picks the transport: a bound device scans over the
 * `device.listProjectSkills` RPC, the local desktop reads over Electron IPC. The
 * SWR key is stable across callers (the `/` slash menu and the SkillsList UI
 * hook), so they dedupe a single fetch. Pass `undefined` workingDirectory to
 * keep the hook inert — no fetch fires.
 */
export const useFetchProjectSkills = (workingDirectory: string | undefined, deviceId?: string) => {
  const isRemote = !!deviceId;
  return useClientDataSWR<ListProjectSkillsResult | undefined>(
    workingDirectory ? ['project-skills', deviceId ?? 'local', workingDirectory] : null,
    () => projectSkillService.listProjectSkills({ deviceId, scope: workingDirectory! }),
    // Remote skills live on a device this client can't watch for filesystem
    // changes, so refetch on focus to pick up edits made on the device. The
    // local IPC path stays off-focus — its scan is cheap to trigger explicitly
    // and the desktop already sees its own filesystem.
    { revalidateOnFocus: isRemote, shouldRetryOnError: false },
  );
};
