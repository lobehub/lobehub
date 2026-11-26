// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createPageSessions } from '../index';

const { allowed, legacy, meta, roomOpen, roomOpenLive, row, storedOpen } = vi.hoisted(() => ({
  allowed: new Set<string>(),
  legacy: { value: true },
  meta: { value: null as null | { userId: string; workspaceId: string | null } },
  roomOpen: vi.fn(),
  roomOpenLive: vi.fn(),
  row: { value: undefined as undefined | Record<string, unknown> },
  storedOpen: vi.fn(),
}));

vi.mock('@/server/services/resourcePermission', () => ({
  canPerformResourceAction: async ({ action }: { action: string }) => allowed.has(action),
  getResourceMeta: async () => meta.value,
}));

vi.mock('@/server/services/document', () => ({
  DocumentService: class {
    getDocumentById = async () => row.value;
  },
}));

vi.mock('../config', () => ({
  isLegacyPageCollabEnabled: () => legacy.value,
  isPageCollabEnabled: () => true,
}));

vi.mock('../roomSession', () => ({
  RoomPageSessions: class {
    openLiveSession = roomOpenLive;
    openSession = roomOpen;
  },
}));

vi.mock('../dbSession', () => ({
  DbPageSessions: class {
    openSession = storedOpen;
  },
}));

const writer = {
  saveSource: 'llm_call' as const,
  userId: 'u2',
  workspaceId: 'ws_1',
  writeSource: 'agent' as const,
};

describe('createPageSessions', () => {
  beforeEach(() => {
    allowed.clear();
    legacy.value = true;
    meta.value = { userId: 'u1', workspaceId: 'ws_1' };
    row.value = { fileType: 'custom/document', id: 'doc_1', workspaceId: 'ws_1' };
    roomOpen.mockReset();
    roomOpenLive.mockReset();
    storedOpen.mockReset();
  });

  it('refuses a page the writer cannot read before touching its room', async () => {
    row.value = undefined;

    await expect(createPageSessions({} as any, writer).openSession('doc_1')).rejects.toThrow(
      'Page document not found',
    );
    expect(roomOpen).not.toHaveBeenCalled();
  });

  it('refuses a page the writer can only view before touching its room', async () => {
    allowed.add('view');

    await expect(createPageSessions({} as any, writer).openSession('doc_1')).rejects.toThrow(
      'No permission to edit',
    );
    expect(roomOpen).not.toHaveBeenCalled();
  });

  it('opens the room for a writer who can edit the page', async () => {
    allowed.add('edit');

    await createPageSessions({} as any, writer).openSession('doc_1');

    expect(roomOpen).toHaveBeenCalledWith('doc_1');
  });

  it('edits a personal page on its stored row without opening a room', async () => {
    meta.value = { userId: 'u2', workspaceId: null };
    row.value = { fileType: 'custom/document', id: 'doc_1', workspaceId: null };
    const personalWriter = { ...writer, workspaceId: undefined };

    await createPageSessions({} as any, personalWriter).openSession('doc_1', {
      expectedVersion: 3,
    });

    expect(roomOpen).not.toHaveBeenCalled();
    expect(storedOpen).toHaveBeenCalledWith('doc_1', { expectedVersion: 3 });
  });

  it('keeps writing a personal page through a room an older client still has open', async () => {
    meta.value = { userId: 'u2', workspaceId: null };
    row.value = { fileType: 'custom/document', id: 'doc_1', workspaceId: null };
    const live = { commit: vi.fn() };
    roomOpenLive.mockResolvedValue(live);

    const session = await createPageSessions({} as any, {
      ...writer,
      workspaceId: undefined,
    }).openSession('doc_1');

    expect(session).toBe(live);
    expect(roomOpen).not.toHaveBeenCalled();
    expect(storedOpen).not.toHaveBeenCalled();
  });

  it('ignores rooms on a personal page once older clients no longer join them', async () => {
    legacy.value = false;
    meta.value = { userId: 'u2', workspaceId: null };
    row.value = { fileType: 'custom/document', id: 'doc_1', workspaceId: null };
    roomOpenLive.mockResolvedValue({ commit: vi.fn() });

    await createPageSessions({} as any, { ...writer, workspaceId: undefined }).openSession('doc_1');

    expect(roomOpenLive).not.toHaveBeenCalled();
    expect(storedOpen).toHaveBeenCalledWith('doc_1', undefined);
  });
});
