// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createPageSessions } from '../index';

const { allowed, meta, roomOpen, row, storedOpen } = vi.hoisted(() => ({
  allowed: new Set<string>(),
  meta: { value: null as null | { userId: string; workspaceId: string | null } },
  roomOpen: vi.fn(),
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

vi.mock('../config', () => ({ isPageCollabEnabled: () => true }));

vi.mock('../roomSession', () => ({
  RoomPageSessions: class {
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
    meta.value = { userId: 'u1', workspaceId: 'ws_1' };
    row.value = { fileType: 'custom/document', id: 'doc_1' };
    roomOpen.mockReset();
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
});
