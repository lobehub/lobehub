import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAddressBook } from '@/business/server/contact/addressBook';
import type { LobeChatDatabase } from '@/database/type';

import { resolveShareVisitorDeviceAccess, type ShareDeviceAccessSubject } from './deviceAccess';

const { filterAddressBookPeople, isChannelEnabled, requestGrantedUserIds } = vi.hoisted(() => ({
  filterAddressBookPeople: vi.fn(),
  isChannelEnabled: vi.fn(),
  requestGrantedUserIds: vi.fn(),
}));
vi.mock('@/database/models/agentShare', () => ({ AgentShareModel: { requestGrantedUserIds } }));
vi.mock('@/server/services/channel/featureGate', () => ({ isChannelEnabled }));
vi.mock('@/business/server/contact/addressBook', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getAddressBook: vi.fn(() => ({ filterAddressBookPeople })),
}));

const db = {} as LobeChatDatabase;

const share = (
  shareConfig: ShareDeviceAccessSubject['shareConfig'],
  workspaceId: string | null = null,
): ShareDeviceAccessSubject => ({ ownerId: 'owner', shareConfig, workspaceId });

describe('resolveShareVisitorDeviceAccess', () => {
  beforeEach(() => {
    filterAddressBookPeople.mockReset();
    isChannelEnabled.mockReset().mockResolvedValue(true);
    requestGrantedUserIds.mockReset().mockResolvedValue([]);
    vi.mocked(getAddressBook).mockClear();
  });

  it('denies by default, under `none`, and for a stored legacy `all`', async () => {
    expect(await resolveShareVisitorDeviceAccess(db, share({}), 'visitor-1')).toBe(false);
    expect(
      await resolveShareVisitorDeviceAccess(db, share({ deviceAccess: 'none' }), 'visitor-1'),
    ).toBe(false);
    expect(
      await resolveShareVisitorDeviceAccess(db, share({ deviceAccess: 'all' as any }), 'visitor-1'),
    ).toBe(false);
    expect(filterAddressBookPeople).not.toHaveBeenCalled();
  });

  it('denies an unlisted visitor without reading the address book', async () => {
    const config = { deviceAccess: 'allowlist', deviceAllowUserIds: ['bob'] } as const;
    expect(await resolveShareVisitorDeviceAccess(db, share(config), 'visitor-1')).toBe(false);
    expect(
      await resolveShareVisitorDeviceAccess(db, share({ deviceAccess: 'allowlist' }), 'visitor-1'),
    ).toBe(false);
    expect(filterAddressBookPeople).not.toHaveBeenCalled();
  });

  it('grants a listed visitor only while they are in the scope address book', async () => {
    const config = { deviceAccess: 'allowlist', deviceAllowUserIds: ['visitor-1'] } as const;

    filterAddressBookPeople.mockResolvedValue(['visitor-1']);
    expect(await resolveShareVisitorDeviceAccess(db, share(config, 'ws-1'), 'visitor-1')).toBe(
      true,
    );
    // The book is the share owner's scope, not the visitor's.
    expect(getAddressBook).toHaveBeenCalledWith(db, 'owner', 'ws-1');
    expect(filterAddressBookPeople).toHaveBeenCalledWith(['visitor-1']);

    // Removed from contacts (or left the workspace) after being listed.
    filterAddressBookPeople.mockResolvedValue([]);
    expect(await resolveShareVisitorDeviceAccess(db, share(config), 'visitor-1')).toBe(false);
  });

  it('grants every address-book person under `contacts`, without a list', async () => {
    const config = { deviceAccess: 'contacts' } as const;

    filterAddressBookPeople.mockResolvedValue(['visitor-1']);
    expect(await resolveShareVisitorDeviceAccess(db, share(config, 'ws-1'), 'visitor-1')).toBe(
      true,
    );
    expect(getAddressBook).toHaveBeenCalledWith(db, 'owner', 'ws-1');
    expect(filterAddressBookPeople).toHaveBeenCalledWith(['visitor-1']);

    // A stranger, or someone removed from contacts, gets nothing.
    filterAddressBookPeople.mockResolvedValue([]);
    expect(await resolveShareVisitorDeviceAccess(db, share(config), 'visitor-1')).toBe(false);

    // Contacts off for the owner grants nothing either.
    filterAddressBookPeople.mockResolvedValue(['visitor-1']);
    isChannelEnabled.mockResolvedValue(false);
    expect(await resolveShareVisitorDeviceAccess(db, share(config), 'visitor-1')).toBe(false);
  });

  it('grants any visitor under `everyone`, without the list or the address book', async () => {
    isChannelEnabled.mockResolvedValue(false);

    expect(
      await resolveShareVisitorDeviceAccess(db, share({ deviceAccess: 'everyone' }), 'stranger'),
    ).toBe(true);
    expect(filterAddressBookPeople).not.toHaveBeenCalled();
    expect(isChannelEnabled).not.toHaveBeenCalled();
  });

  it('denies a listed contact while contacts are off for the owner', async () => {
    const config = { deviceAccess: 'allowlist', deviceAllowUserIds: ['visitor-1'] } as const;
    filterAddressBookPeople.mockResolvedValue(['visitor-1']);
    isChannelEnabled.mockResolvedValue(false);

    expect(await resolveShareVisitorDeviceAccess(db, share(config, 'ws-1'), 'visitor-1')).toBe(
      false,
    );
    expect(isChannelEnabled).toHaveBeenCalledWith('owner');
  });

  // The owner approved the visitor's request to use the Agent (a group mention, or a DM card):
  // that names them as explicitly as a contact, so the address book is not asked of them.
  it.each(['allowlist', 'contacts'] as const)(
    'grants a listed visitor the owner approved by request under `%s`, outside the book',
    async (deviceAccess) => {
      const subject = {
        ...share({ deviceAccess, deviceAllowUserIds: ['visitor-1'] }),
        shareId: 'share-1',
      };
      filterAddressBookPeople.mockResolvedValue([]);
      requestGrantedUserIds.mockResolvedValue(['visitor-1']);

      expect(await resolveShareVisitorDeviceAccess(db, subject, 'visitor-1')).toBe(true);
      expect(requestGrantedUserIds).toHaveBeenCalledWith(db, 'share-1', ['visitor-1']);

      // Revoking their grant (or unlisting them) withdraws it.
      requestGrantedUserIds.mockResolvedValue([]);
      expect(await resolveShareVisitorDeviceAccess(db, subject, 'visitor-1')).toBe(false);
      expect(
        await resolveShareVisitorDeviceAccess(
          db,
          { ...subject, shareConfig: { deviceAccess, deviceAllowUserIds: [] } },
          'visitor-1',
        ),
      ).toBe(false);
    },
  );
});
