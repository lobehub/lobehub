import { isDesktop } from '@lobechat/const';
import type { DeviceSandboxCapabilityResult } from '@lobechat/electron-client-ipc';
import type { SWRResponse } from 'swr';

import { useClientDataSWR } from '@/libs/swr';
import { localFileService } from '@/services/electron/localFileService';

const LOCAL_SANDBOX_CAPABILITY_SWR_KEY = 'local-sandbox-capability';

/**
 * Whether this machine can actually run sandboxed commands.
 *
 * Asked instead of guessed: availability depends on host binaries and OS
 * configuration, not on the platform string, so a `process.platform` check in
 * the renderer would offer the option on hosts that cannot honour it.
 *
 * The verdict can change during a session — in one direction. The desktop's
 * cheap probe only checks that the backend is installed; parts of the fence are
 * exercised only when the first real process spawns, so a host can pass the
 * probe and still fail every command. The desktop downgrades itself when that
 * happens, which is why callers revalidate when they are about to show the
 * option rather than trusting the first answer forever.
 *
 * Web has no local machine to fence, so it never asks.
 */
export const useLocalSandboxCapability = (): SWRResponse<DeviceSandboxCapabilityResult> =>
  useClientDataSWR<DeviceSandboxCapabilityResult>(
    isDesktop ? [LOCAL_SANDBOX_CAPABILITY_SWR_KEY] : null,
    () => localFileService.getSandboxCapability(),
    { revalidateOnFocus: false, revalidateOnReconnect: false },
  );
