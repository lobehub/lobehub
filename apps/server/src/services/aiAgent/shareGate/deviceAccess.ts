import debug from 'debug';

import { getAddressBook } from '@/business/server/contact/addressBook';
import type { AgentShareConfig } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { isChannelEnabled } from '@/server/services/channel/featureGate';

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

/** The share fields the device decision reads: its config and the scope that owns its address book. */
export interface ShareDeviceAccessSubject {
  ownerId: string;
  shareConfig: Pick<AgentShareConfig, 'deviceAccess' | 'deviceAllowUserIds'>;
  workspaceId?: string | null;
}

/**
 * Whether `visitorUserId` may run on the shared agent's execution environment.
 *
 * The only place `shareConfig.deviceAccess` is interpreted; every share-gate
 * builder calls it so a fresh turn and a deferred init decide alike.
 *
 * `contacts` grants every visitor currently in the address book of the
 * Agent's scope. `allowlist` grants a listed visitor only while they are still
 * in that address book (`AddressBook.filterAddressBookPeople`):
 * the owner's personal contacts, or the workspace's members and external
 * contacts. The list was checked against the same book when written; checking
 * again here makes removing a contact, or leaving the workspace, revoke the
 * grant without anyone editing the share. The address book exists only while
 * Channels are enabled for the owner, so turning them off grants nothing.
 */
export const resolveShareVisitorDeviceAccess = async (
  db: LobeChatDatabase,
  share: ShareDeviceAccessSubject,
  visitorUserId: string,
): Promise<boolean> => {
  const { deviceAccess, deviceAllowUserIds } = share.shareConfig;
  if (deviceAccess !== 'allowlist' && deviceAccess !== 'contacts') return false;

  // `contacts` skips the list: being in the address book is the whole grant.
  if (deviceAccess === 'allowlist' && !deviceAllowUserIds?.includes(visitorUserId)) {
    log('allowlist denied visitor %s: not listed', visitorUserId);
    return false;
  }

  if (!(await isChannelEnabled(share.ownerId))) {
    log('allowlist denied visitor %s: contacts are off for the owner', visitorUserId);
    return false;
  }

  const [inBook] = await getAddressBook(
    db,
    share.ownerId,
    share.workspaceId,
  ).filterAddressBookPeople([visitorUserId]);
  // The most likely creator complaint ("I listed them but it doesn't work"),
  // so it gets its own line.
  if (!inBook) log('allowlist denied visitor %s: no longer in the address book', visitorUserId);
  return !!inBook;
};
