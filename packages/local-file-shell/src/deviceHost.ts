import os from 'node:os';

/**
 * Name the host and OS account this process runs as, e.g.
 * `DESKTOP-1 (OS user Admin)`.
 *
 * Path failures are often not about the path at all: when a device is re-launched
 * under another OS account (or a cloned machine reports the same deviceId), every
 * path pinned from the earlier account stops existing at once. Naming the account
 * in the error lets the model and the user see that the execution context
 * changed instead of retrying the same path or silently moving elsewhere.
 */
export const describeDeviceHost = (): string => {
  let username: string | undefined;
  try {
    username = os.userInfo().username;
  } catch {
    // `userInfo` throws for a uid without a passwd entry (some containers).
  }
  return username ? `${os.hostname()} (OS user ${username})` : os.hostname();
};
