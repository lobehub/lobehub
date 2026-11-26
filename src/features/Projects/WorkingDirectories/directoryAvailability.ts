/** Why a project folder cannot be worked in yet, or nothing when it can. */
export type DirectoryUnavailableReason = 'failed' | 'missing' | 'needsManager' | 'offline';

/** What became of enabling a folder: still running, or why it could not be. */
export type DirectoryEnableAttempt = 'failed' | 'missing' | 'pending';

/**
 * Whether a project folder can be worked in, and when not, why — in words a
 * person can act on. A folder becomes usable once it is enabled for the
 * project's environment; that is done for them while its device is online, so
 * the only states left to show are the ones that need something from them.
 */
export const directoryUnavailableReason = ({
  attempt,
  canManage,
  enabled,
  online,
  presenceUnknown,
}: {
  /** The automatic enable for this folder, when one was tried. */
  attempt?: DirectoryEnableAttempt;
  canManage: boolean;
  enabled: boolean;
  online: boolean;
  /** The device list has not confirmed presence yet: say nothing until it does. */
  presenceUnknown: boolean;
}): DirectoryUnavailableReason | undefined => {
  if (enabled || presenceUnknown || attempt === 'pending') return;
  if (attempt === 'missing' || attempt === 'failed') return attempt;
  if (!online) return 'offline';
  // Online, never tried: one who may change the project enables it on sight.
  return canManage ? undefined : 'needsManager';
};

/** A refused enable that means the folder is not on the device (any more). */
export const isMissingDirectoryError = (error: unknown) =>
  error instanceof Error &&
  /does not exist|working directory is unavailable|not a directory/i.test(error.message);
