import type { LobeChatDatabase } from '@lobechat/database';
import debug from 'debug';

import { UserModel } from '@/database/models/user';
import { deviceGateway, type DeviceSystemInfo } from '@/server/services/deviceGateway';

const log = debug('lobe-server:ai-agent-service');

type UserSettings = Awaited<ReturnType<UserModel['getUserSettings']>>;

export interface RunFactsSource {
  db: LobeChatDatabase;
  userId: string;
  workspaceId?: string;
}

/**
 * Facts that cannot change within one turn, read once and shared by every
 * stage of it. The send window (tool discovery, then operation prep) asked
 * some of them twice: a routed device answered the same system-info RPC over
 * its WebSocket, and the user's settings row was read once for the market
 * access token behind LobeHub skills and again for the memory and timezone
 * settings. Each of those is a round trip between the user pressing send and
 * the operation existing.
 *
 * Failures stay the fetcher's concern; this only remembers the answer —
 * including "there is none", so an unreachable device is not asked twice.
 */
export interface RunFacts {
  /** System info of a device routed for this run; one RPC per device and scope. */
  deviceSystemInfo: (
    deviceId: string,
    scope?: 'personal' | 'workspace',
  ) => Promise<DeviceSystemInfo | undefined>;
  /**
   * A user's settings row. Asked for the market access token when resolving
   * LobeHub skills and for the memory / timezone settings of the turn.
   * Defaults to the run's own user; a share-visitor turn asks for the visitor.
   */
  userSettings: (userId?: string) => Promise<UserSettings | undefined>;
}

/** Remember the promise, not the value, so concurrent callers share one read. */
const memoize = <T>(read: (key: string) => Promise<T>) => {
  const pending = new Map<string, Promise<T>>();
  return (key: string): Promise<T> => {
    const hit = pending.get(key);
    if (hit) return hit;
    const promise = read(key);
    pending.set(key, promise);
    return promise;
  };
};

const KEY_SEPARATOR = String.fromCodePoint(0);

export const createRunFacts = ({ db, userId, workspaceId }: RunFactsSource): RunFacts => {
  const readDeviceSystemInfo = memoize(async (key: string) => {
    const [deviceId, scope] = key.split(KEY_SEPARATOR);
    // Workspace devices need the workspace id to resolve their connection;
    // personal ones (including a workspace run routed to the caller's own
    // machine) must not receive it.
    return deviceGateway.queryDeviceSystemInfo(
      userId,
      deviceId,
      scope === 'workspace' ? workspaceId : undefined,
    );
  });

  const readUserSettings = memoize(async (targetUserId: string) => {
    try {
      return await new UserModel(db, targetUserId).getUserSettings();
    } catch (error) {
      log('runFacts: failed to read settings for %s: %O', targetUserId, error);
      return undefined;
    }
  });

  return {
    deviceSystemInfo: (deviceId, scope) =>
      readDeviceSystemInfo([deviceId, scope ?? 'personal'].join(KEY_SEPARATOR)),
    userSettings: (targetUserId) => readUserSettings(targetUserId ?? userId),
  };
};
