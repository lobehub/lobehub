import { useCallback } from 'react';

import { lambdaQuery } from '@/libs/trpc/client';

import { nextWorkingDirs, type WorkingDirEntry } from './deviceCwd';

/**
 * Persist a working-directory choice to a device's registry record
 * (`defaultCwd` + `workingDirs`) with an **optimistic** update of the
 * `listDevices` cache, so the picker reflects the pick instantly and the
 * server's `device.defaultCwd` (read by the hetero device-dispatch branch)
 * stays in sync. Rolls back on error.
 */
export const useUpdateDeviceCwd = () => {
  const utils = lambdaQuery.useUtils();

  const mutation = lambdaQuery.device.updateDevice.useMutation({
    onMutate: async ({ defaultCwd, deviceId, workingDirs }) => {
      // Optimistic write: cancel in-flight refetches so they don't clobber it,
      // then patch the touched device in place. onSettled re-fetches the truth
      // afterwards (on both success and error), so a failed write self-corrects
      // without a manual rollback.
      await utils.device.listDevices.cancel();
      utils.device.listDevices.setData(undefined, (old) => {
        if (!old) return old;
        // `listDevices` returns a union (registered device | online-only ghost);
        // spreading widens the touched item out of its branch, so re-assert the
        // query's own element type rather than fight the literal union.
        return old.map((device) =>
          device.deviceId === deviceId
            ? {
                ...device,
                defaultCwd: defaultCwd ?? device.defaultCwd,
                workingDirs: workingDirs ?? device.workingDirs,
              }
            : device,
        ) as typeof old;
      });
    },
    onSettled: () => utils.device.listDevices.invalidate(),
  });

  return useCallback(
    (
      deviceId: string,
      entry: WorkingDirEntry,
      currentWorkingDirs: readonly WorkingDirEntry[] = [],
      // Local-mode runs only want to record the dir in the working-dirs list,
      // not repoint the device's default working directory.
      options: { setDefault?: boolean } = {},
    ) => {
      const trimmed = entry.path.trim();
      if (!trimmed) return;
      const setDefault = options.setDefault ?? true;
      return mutation.mutateAsync({
        ...(setDefault ? { defaultCwd: trimmed } : {}),
        deviceId,
        workingDirs: nextWorkingDirs(entry, currentWorkingDirs),
      });
    },
    [mutation],
  );
};
