import debug from 'debug';

import { UserModel } from '@/database/models/user';
import type { AgentShareConfig } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { DEVICE_TOOL_IDENTIFIERS, REMOTE_DEVICE_TOOL_IDENTIFIERS } from '../deviceToolRegistry';

const log = debug('lobe-server:share-gate:device-access');

/**
 * Builtin tools that act on the agent's execution device. They are not picked
 * in the share tool picker: `shareConfig.deviceAccess` is their grant, the same
 * way an IM bot's `devicePolicy` governs device tools without a per-tool list.
 *
 * Derived from the engine's device-tool catalog so a new device tool follows
 * the grant, minus the remote-device picker (`listOnlineDevices` /
 * `activateDevice`): a visitor runs only on the device the Agent's execution
 * environment routes to, never one the visitor's model picks from the
 * creator's other machines. Not being on the share allowlist, the picker stays
 * default-denied at assembly and dispatch.
 */
export const SHARE_DEVICE_BUILTIN_IDENTIFIERS: ReadonlySet<string> = new Set(
  [...DEVICE_TOOL_IDENTIFIERS].filter((id) => !REMOTE_DEVICE_TOOL_IDENTIFIERS.has(id)),
);

export const isShareDeviceBuiltin = (identifier: string) =>
  SHARE_DEVICE_BUILTIN_IDENTIFIERS.has(identifier);

/**
 * Whether `visitorUserId` may run on the shared agent's execution environment.
 *
 * The only place `shareConfig.deviceAccess` is interpreted; every share-gate
 * builder calls it so a fresh turn and a deferred init decide alike.
 *
 * `allowlist` matches the visitor's account email only when it is verified:
 * an unverified address is a claim anyone can make at sign-up, and the grant
 * hands over the creator's machine. Deployments that never verify email
 * therefore fail closed under `allowlist`; `all` still works there.
 */
export const resolveShareVisitorDeviceAccess = async (
  db: LobeChatDatabase,
  shareConfig: Pick<AgentShareConfig, 'deviceAccess' | 'deviceAllowEmails'>,
  visitorUserId: string,
): Promise<boolean> => {
  switch (shareConfig.deviceAccess) {
    case 'all': {
      return true;
    }
    case 'allowlist': {
      const allowEmails = shareConfig.deviceAllowEmails;
      if (!allowEmails?.length) {
        log('allowlist denied visitor %s: the list is empty', visitorUserId);
        return false;
      }

      const visitor = await UserModel.findById(db, visitorUserId);
      if (!visitor?.email || !visitor.emailVerified) {
        // The most likely creator complaint ("I listed them but it doesn't
        // work"), so it gets its own line; never log the address itself.
        log('allowlist denied visitor %s: no verified account email', visitorUserId);
        return false;
      }

      const listed = allowEmails.includes(visitor.email.trim().toLowerCase());
      if (!listed) log('allowlist denied visitor %s: email not listed', visitorUserId);
      return listed;
    }
    default: {
      return false;
    }
  }
};
