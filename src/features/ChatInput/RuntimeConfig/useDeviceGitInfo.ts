import { lambdaQuery } from '@/libs/trpc/client';

/**
 * Git status (branch / file changes / PR) for a directory on a **remote** device,
 * fetched via the `device.gitInfo` RPC so it works from web and from another
 * desktop. Disabled (no request) until both `deviceId` and `scope` are present.
 */
export const useDeviceGitInfo = (deviceId?: string, scope?: string, isGithub = false) =>
  lambdaQuery.device.gitInfo.useQuery(
    { deviceId: deviceId ?? '', isGithub, scope: scope ?? '' },
    {
      enabled: !!deviceId && !!scope,
      refetchOnWindowFocus: false,
      staleTime: 60 * 1000,
    },
  );
