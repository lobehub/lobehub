// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolvePageAccess } from '../index';

const { allowed, meta } = vi.hoisted(() => ({
  allowed: new Set<string>(),
  meta: { value: null as null | { userId: string; workspaceId: string | null } },
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
