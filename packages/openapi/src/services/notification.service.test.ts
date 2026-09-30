// @vitest-environment node
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
