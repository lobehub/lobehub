import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePageEditable } from './usePageEditable';

const editorState = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock('./store', () => ({
  usePageEditorStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector(editorState.value),
}));

vi.mock('./usePageLockedByOther', () => ({ usePageLockedByOther: () => false }));

vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));

vi.mock('@/features/ResourcePermission/useResourceAccess', () => ({
  useResourceAccess: () => ({ canEditResource: true }),
}));

describe('usePageEditable in a collaboration room', () => {
  beforeEach(() => {
    editorState.value = {
      collab: { access: 'edit', pending: 0, status: 'synced' },
      documentId: 'doc_1',
      isWorkspacePage: true,
    };
  });

  it('lets an editor type once the room synced', () => {
    expect(renderHook(() => usePageEditable()).result.current).toBe(true);
  });

  it('turns the page read-only while the room blocks it', () => {
    editorState.value = {
      ...editorState.value,
      collab: { access: 'edit', blocked: 'too_large', pending: 0, status: 'synced' },
    };

    expect(renderHook(() => usePageEditable()).result.current).toBe(false);
  });
});
