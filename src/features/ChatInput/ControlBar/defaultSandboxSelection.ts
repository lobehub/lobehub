import { SANDBOX_DRIVE_ROOT } from '@lobechat/builtin-tool-cloud-sandbox';

import type { SandboxSelection } from './useSandboxPlacement';

/**
 * Where a new conversation's cloud sandbox works when the person has not
 * picked anything, for an account whose plan includes a drive: the root of a
 * drive that is theirs alone.
 *
 * - personal account — the root of their own drive;
 * - workspace — the root of the member's personal drive, for every agent. The
 *   public drive's root holds every member's folders and is not a folder
 *   anyone may work in, so a shared agent starts on the member's own drive too;
 *   moving to a folder on the public drive is an explicit pick.
 */
export const resolveDefaultSandboxSelection = (workspaceId?: string | null): SandboxSelection =>
  workspaceId
    ? { drive: 'personal', workingDirectory: SANDBOX_DRIVE_ROOT }
    : { workingDirectory: SANDBOX_DRIVE_ROOT };
