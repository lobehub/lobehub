// @vitest-environment node
import { mergeNotificationSettings } from '@lobechat/utils/mergeNotificationSettings';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { NotificationRestService } from './notification.service';

const { countLinkedMock, getNavigationCountsMock, getUnreadCountMock, listPendingForUserMock } =
  vi.hoisted(() => ({
    countLinkedMock: vi.fn(),
    getNavigationCountsMock: vi.fn(),
    getUnreadCountMock: vi.fn(),
    listPendingForUserMock: vi.fn(),
  }));

vi.mock('@/const/rbac', () => ({ ALL_SCOPE: 'all' }));
vi.mock('@lobechat/database', () => ({
  buildWorkspacePayload: vi.fn(),
  buildWorkspaceWhere: vi.fn(),
}));
vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    hasAnyPermission = vi.fn().mockResolvedValue(false);
  },
}));
vi.mock('@/database/schemas', () => ({
  agents: {},
  aiModels: {},
  aiProviders: {},
  files: {},
  knowledgeBases: {},
  messages: {},
  sessions: {},
  topics: {},
}));
vi.mock('@/utils/rbac', () => ({ getScopePermissions: () => [] }));
vi.mock('@/database/models/notification', () => ({
  NotificationModel: class {
    countLinkedToTransfers = countLinkedMock;
    getNavigationCounts = getNavigationCountsMock;
    getUnreadCount = getUnreadCountMock;
  },
}));
vi.mock('@/database/models/resourceTransferRequest', () => ({
  ResourceTransferRequestModel: class {
    listPendingForUser = listPendingForUserMock;
  },
}));

// In-memory stand-ins for the two settings stores, keyed like their tables.
const { personalSettings, workspacePreferences } = vi.hoisted(() => ({
  personalSettings: new Map<string, any>(),
  workspacePreferences: new Map<string, any>(),
}));
vi.mock('@/database/models/user', () => ({
  UserModel: class {
    constructor(
      _db: unknown,
      private userId: string,
    ) {}
    getNotificationSetting = async () => personalSettings.get(this.userId) ?? {};
    mergeNotificationSetting = async (patch: any) => {
      const next = mergeNotificationSettings(personalSettings.get(this.userId), patch);
      personalSettings.set(this.userId, next);
      return next;
    };
  },
}));
vi.mock('@/database/models/workspaceUserSettings', () => ({
  WorkspaceUserSettingsModel: class {
    constructor(
      _db: unknown,
      private userId: string,
      private workspaceId: string,
    ) {}
    private get key() {
      return `${this.workspaceId}/${this.userId}`;
    }
    getPreference = async () => workspacePreferences.get(this.key) ?? {};
    updatePreference = async (patch: any) => {
      const current = workspacePreferences.get(this.key) ?? {};
      const preference = {
        ...current,
        notification: mergeNotificationSettings(current.notification, patch.notification),
      };
      workspacePreferences.set(this.key, preference);
      return { preference };
    };
  },
}));

const CALLER = 'me';
const WORKSPACE = 'ws-1';

/**
 * A pending transfer keeps prompting even when its linked inbox row was read,
 * archived or never delivered, so the REST counts must reconcile against the
 * live request cards exactly like the tRPC inbox does — otherwise the SDK sees
 * a different number than the app.
 */
describe('NotificationRestService live-transfer reconciliation', () => {
  const service = (workspaceId?: string) =>
    new NotificationRestService({} as LobeChatDatabase, CALLER, workspaceId);

  beforeEach(() => {
    vi.clearAllMocks();
    listPendingForUserMock.mockResolvedValue([]);
    countLinkedMock.mockResolvedValue({ total: 0, unread: 0 });
  });

  it('returns the raw unread count in personal mode', async () => {
    getUnreadCountMock.mockResolvedValue(4);

    await expect(service().getUnreadCount()).resolves.toBe(4);
    expect(listPendingForUserMock).not.toHaveBeenCalled();
  });

  it('counts a live request whose linked row was already read', async () => {
    listPendingForUserMock.mockResolvedValue([{ id: 'req-1' }, { id: 'req-2' }]);
    getUnreadCountMock.mockResolvedValue(1);
    countLinkedMock.mockResolvedValue({ total: 1, unread: 1 });

    // 1 raw unread row + 2 live cards − 1 card that already had an unread row.
    await expect(service(WORKSPACE).getUnreadCount()).resolves.toBe(2);
    expect(countLinkedMock).toHaveBeenCalledWith(['req-1', 'req-2']);
  });

  it('swaps the pending category over to the live request cards', async () => {
    listPendingForUserMock.mockResolvedValue([{ id: 'req-1' }]);
    getNavigationCountsMock.mockResolvedValue([
      { category: 'pending', readCount: 1, totalCount: 2, unreadCount: 1 },
      { category: 'system', readCount: 3, totalCount: 3, unreadCount: 0 },
    ]);
    countLinkedMock.mockResolvedValue({ total: 1, unread: 0 });

    await expect(service(WORKSPACE).getNavigationCounts()).resolves.toEqual([
      { category: 'pending', readCount: 0, totalCount: 2, unreadCount: 2 },
      { category: 'system', readCount: 3, totalCount: 3, unreadCount: 0 },
    ]);
  });

  it('adds a pending category when the request has no linked row at all', async () => {
    listPendingForUserMock.mockResolvedValue([{ id: 'req-1' }]);
    getNavigationCountsMock.mockResolvedValue([
      { category: 'system', readCount: 3, totalCount: 3, unreadCount: 0 },
    ]);

    await expect(service(WORKSPACE).getNavigationCounts()).resolves.toEqual([
      { category: 'system', readCount: 3, totalCount: 3, unreadCount: 0 },
      { category: 'pending', readCount: 0, totalCount: 1, unreadCount: 1 },
    ]);
  });
});

describe('NotificationRestService settings', () => {
  const service = (workspaceId?: string) =>
    new NotificationRestService({} as LobeChatDatabase, CALLER, workspaceId);

  beforeEach(() => {
    personalSettings.clear();
    workspacePreferences.clear();
  });

  it('patches personal settings without dropping sibling switches', async () => {
    personalSettings.set(CALLER, { email: { enabled: true }, inbox: { enabled: false } });

    await expect(
      service(WORKSPACE).updateSettings('personal', {
        email: { items: { billing: { a: false } } },
      }),
    ).resolves.toEqual({
      email: { enabled: true, items: { billing: { a: false } } },
      inbox: { enabled: false },
    });
    // A personal write never lands in the workspace store, even with a workspace on the request.
    expect(await service(WORKSPACE).getSettings('workspace')).toEqual({});
  });

  it('keeps workspace preferences separate from personal settings', async () => {
    await service(WORKSPACE).updateSettings('workspace', { im: { enabled: false } });

    expect(await service(WORKSPACE).getSettings('workspace')).toEqual({ im: { enabled: false } });
    expect(await service('ws-2').getSettings('workspace')).toEqual({});
    expect(await service().getSettings('personal')).toEqual({});
  });

  it('rejects workspace scope without a workspace on the request', async () => {
    await expect(service().getSettings('workspace')).rejects.toMatchObject({
      name: 'ValidationError',
    });
    await expect(
      service().updateSettings('workspace', { im: { enabled: false } }),
    ).rejects.toMatchObject({ name: 'ValidationError' });
  });
});
