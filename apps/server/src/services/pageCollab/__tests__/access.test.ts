// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolvePageAccess, resolveRoomAccess } from '../index';

const { allowed, legacy, meta } = vi.hoisted(() => ({
  allowed: new Set<string>(),
  legacy: { value: true },
  meta: { value: null as null | { userId: string; workspaceId: string | null } },
}));

vi.mock('../config', () => ({
  isLegacyPageCollabEnabled: () => legacy.value,
  isPageCollabEnabled: () => true,
}));

vi.mock('@/server/services/resourcePermission', () => ({
  canPerformResourceAction: async ({ action }: { action: string }) => allowed.has(action),
  getResourceMeta: async () => meta.value,
}));

describe('resolvePageAccess', () => {
  beforeEach(() => {
    allowed.clear();
    meta.value = null;
  });

  it('denies a page that does not exist', async () => {
    expect(await resolvePageAccess({} as any, 'u1', 'doc_1')).toBe('none');
  });

  it('lets only the owner edit a personal page', async () => {
    meta.value = { userId: 'u1', workspaceId: null };

    expect(await resolvePageAccess({} as any, 'u1', 'doc_1')).toBe('edit');
    expect(await resolvePageAccess({} as any, 'u2', 'doc_1')).toBe('none');
  });

  it('follows workspace permissions for a workspace page', async () => {
    meta.value = { userId: 'u1', workspaceId: 'ws_1' };

    expect(await resolvePageAccess({} as any, 'u2', 'doc_1')).toBe('none');

    allowed.add('view');
    expect(await resolvePageAccess({} as any, 'u2', 'doc_1')).toBe('view');

    allowed.add('edit');
    expect(await resolvePageAccess({} as any, 'u2', 'doc_1')).toBe('edit');
  });
});

describe('resolveRoomAccess', () => {
  beforeEach(() => {
    allowed.clear();
    legacy.value = true;
    meta.value = { userId: 'u1', workspaceId: null };
  });

  it('keeps an older client editing a personal page in its room while it still joins one', async () => {
    expect(await resolveRoomAccess({} as any, 'u1', 'doc_1')).toBe('edit');
  });

  it('keeps every client out of a personal page room once only workspace pages have rooms', async () => {
    legacy.value = false;

    expect(await resolveRoomAccess({} as any, 'u1', 'doc_1')).toBe('none');
  });

  it('follows page access for a workspace page', async () => {
    legacy.value = false;
    meta.value = { userId: 'u1', workspaceId: 'ws_1' };
    allowed.add('view');

    expect(await resolveRoomAccess({} as any, 'u2', 'doc_1')).toBe('view');
  });
});
