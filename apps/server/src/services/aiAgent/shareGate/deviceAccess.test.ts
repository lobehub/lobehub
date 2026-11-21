import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContactModel } from '@/database/models/contact';
import type { LobeChatDatabase } from '@/database/type';

import { resolveShareVisitorDeviceAccess, type ShareDeviceAccessSubject } from './deviceAccess';

const { filterAddressBookPeople, isChannelEnabled } = vi.hoisted(() => ({
  filterAddressBookPeople: vi.fn(),
  isChannelEnabled: vi.fn(),
}));
vi.mock('@/server/services/channel/featureGate', () => ({ isChannelEnabled }));
vi.mock('@/database/models/contact', () => ({
  ContactModel: vi.fn(function () {
    return { filterAddressBookPeople };
  }),
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
    vi.mocked(ContactModel).mockClear();
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
    expect(ContactModel).toHaveBeenCalledWith(db, 'owner', 'ws-1');
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
    expect(ContactModel).toHaveBeenCalledWith(db, 'owner', 'ws-1');
    expect(filterAddressBookPeople).toHaveBeenCalledWith(['visitor-1']);

    // A stranger, or someone removed from contacts, gets nothing.
    filterAddressBookPeople.mockResolvedValue([]);
    expect(await resolveShareVisitorDeviceAccess(db, share(config), 'visitor-1')).toBe(false);

    // Contacts off for the owner grants nothing either.
    filterAddressBookPeople.mockResolvedValue(['visitor-1']);
    isChannelEnabled.mockResolvedValue(false);
    expect(await resolveShareVisitorDeviceAccess(db, share(config), 'visitor-1')).toBe(false);
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
});
