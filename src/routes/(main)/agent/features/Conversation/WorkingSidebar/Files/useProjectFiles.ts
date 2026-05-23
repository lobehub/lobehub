import { isDesktop } from '@lobechat/const';
import type { ProjectFileIndexResult } from '@lobechat/electron-client-ipc';

import { useClientDataSWR } from '@/libs/swr';
import { localFileService } from '@/services/electron/localFileService';

export const useProjectFiles = (dirPath: string | undefined) => {
  const enabled = isDesktop && Boolean(dirPath);
  const key = enabled ? ['project-file-index', dirPath] : null;

  return useClientDataSWR<ProjectFileIndexResult>(
    key,
    () => localFileService.getProjectFileIndex({ scope: dirPath! }),
    {
      focusThrottleInterval: 30 * 1000,
      revalidateOnFocus: true,
      shouldRetryOnError: false,
    },
  );
};
