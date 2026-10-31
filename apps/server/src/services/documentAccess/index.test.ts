// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';
import { canPerformResourceAction, getResourceMeta } from '@/server/services/resourcePermission';

import { getDocumentForViewer } from './index';

vi.mock('@/server/services/resourcePermission', () => ({
  canPerformResourceAction: vi.fn(),
  getResourceMeta: vi.fn(),
}));

vi.mock('@/server/services/knowledgeBaseAccess', () => ({
  assertContentsNotInRestrictedKnowledgeBase: vi.fn(),
}));

const getDocumentById = vi.fn();
const createContext = (workspaceId: string | null = 'ws-1') => ({
  documentService: { getDocumentById },
  serverDB: {} as LobeChatDatabase,
  userId: 'viewer',
  workspaceId,
  workspacePermissionCodes: ['document:read:all'],
});

describe('getDocumentForViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDocumentById.mockResolvedValue(undefined);
  });

  it('returns a readable document without checking access again', async () => {
    const doc = { id: 'doc-1' };
    getDocumentById.mockResolvedValue(doc);

    await expect(getDocumentForViewer(createContext(), 'doc-1')).resolves.toBe(doc);
    expect(getResourceMeta).not.toHaveBeenCalled();
  });

  it('rejects with FORBIDDEN when the page is another member’s private page', async () => {
    vi.mocked(getResourceMeta).mockResolvedValue({
      userId: 'creator',
      visibility: 'private',
      workspaceId: 'ws-1',
    });
    vi.mocked(canPerformResourceAction).mockResolvedValue(false);

    const error = await getDocumentForViewer(createContext(), 'doc-1').catch((e) => e);

    expect(error).toBeInstanceOf(TRPCError);
    expect(error.code).toBe('FORBIDDEN');
    expect(canPerformResourceAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'view',
        grantedPermissions: ['document:read:all'],
        resourceId: 'doc-1',
        userId: 'viewer',
        workspaceId: 'ws-1',
      }),
    );
  });

  it('stays not found when the document does not exist', async () => {
    vi.mocked(getResourceMeta).mockResolvedValue(undefined);

    await expect(getDocumentForViewer(createContext(), 'doc-1')).resolves.toBeUndefined();
    expect(canPerformResourceAction).not.toHaveBeenCalled();
  });

  it('stays not found for a document in another workspace', async () => {
    vi.mocked(getResourceMeta).mockResolvedValue({
      userId: 'creator',
      visibility: 'public',
      workspaceId: 'ws-2',
    });

    await expect(getDocumentForViewer(createContext(), 'doc-1')).resolves.toBeUndefined();
    expect(canPerformResourceAction).not.toHaveBeenCalled();
  });

  it('stays not found when the viewer could see it but the scoped read hid it', async () => {
    vi.mocked(getResourceMeta).mockResolvedValue({
      userId: 'creator',
      visibility: 'public',
      workspaceId: 'ws-1',
    });
    vi.mocked(canPerformResourceAction).mockResolvedValue(true);

    await expect(getDocumentForViewer(createContext(), 'doc-1')).resolves.toBeUndefined();
  });

  it('never probes other rows in personal mode', async () => {
    await expect(getDocumentForViewer(createContext(null), 'doc-1')).resolves.toBeUndefined();
    expect(getResourceMeta).not.toHaveBeenCalled();
  });
});
