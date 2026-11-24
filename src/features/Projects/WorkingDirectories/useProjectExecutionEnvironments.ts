import type { DeviceListItem } from '@lobechat/types';
import { useCallback, useMemo } from 'react';
import useSWR from 'swr';

import { projectWorkingDirectoryService } from '@/services/projectWorkingDirectory';
import type { ProjectDirectory } from '@/store/projectWorkingDirectory';
import { useProjectDirectories, useProjectDirectoryStore } from '@/store/projectWorkingDirectory';

import {
  orderExecutionEnvironments,
  type ProjectExecutionEnvironment,
} from './executionEnvironments';

const executionOrderKey = (projectId?: string) =>
  projectId ? ['project-execution-order', projectId] : null;

/**
 * Whether a folder can take a new conversation now: its device is online and
 * the folder is ready to run (linked to the project's environment, writable).
 */
export const isExecutionDirectoryAvailable = (
  directory: ProjectDirectory,
  devices: readonly DeviceListItem[] | undefined,
) => {
  const device = devices?.find((item) => item.deviceId === directory.deviceId);
  return !!directory.runnable && !!device?.online && !device.onlineUnknown;
};

/**
 * A project's execution environments in priority order — its device folders
 * and the cloud sandbox — and the way to reorder them. The order is the
 * priority a new conversation follows; the folders come from the project's
 * directory list, the sandbox's place from `executionOrder`.
 */
export const useProjectExecutionEnvironments = (projectId?: string, enabled = true) => {
  const directoriesRequest = useProjectDirectoryStore((s) => s.useFetchDirectories)(
    projectId,
    enabled && !!projectId,
  );
  const directories = useProjectDirectories(projectId);
  const orderRequest = useSWR(enabled ? executionOrderKey(projectId) : null, async () => {
    const result = await projectWorkingDirectoryService.executionOrder(projectId!);
    return result.data;
  });

  const ordered: ProjectExecutionEnvironment[] = useMemo(
    () => orderExecutionEnvironments(directories, orderRequest.data?.sandbox ?? 0),
    [directories, orderRequest.data?.sandbox],
  );

  const reorder = useCallback(
    async (order: string[]) => {
      if (!projectId) return;
      // The sandbox's new place, shown at once; the folders' places come back
      // with the list.
      const sandbox = order.indexOf('sandbox');
      await orderRequest.mutate(
        async () => {
          await projectWorkingDirectoryService.reorderExecutionEnvironments({ order, projectId });
          await directoriesRequest.revalidate();
          return { sandbox };
        },
        { optimisticData: { sandbox }, rollbackOnError: true },
      );
    },
    [directoriesRequest, orderRequest, projectId],
  );

  return {
    directories,
    error: directoriesRequest.error || orderRequest.error,
    loaded: directoriesRequest.hasData && orderRequest.data !== undefined,
    ordered,
    reorder,
    revalidate: () => Promise.all([directoriesRequest.revalidate(), orderRequest.mutate()]),
  };
};
