import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ProjectionDevtoolsModule from '@/projection/devtools';
import type { ManagedProjection } from '@/projection/devtools';

import { useProjectionEditor } from './useProjectionEditor';

const mocks = vi.hoisted(() => ({ applyProjectionFragmentEdit: vi.fn() }));

vi.mock('@/projection/devtools', async (importOriginal) => {
  const actual = await importOriginal<typeof ProjectionDevtoolsModule>();
  return { ...actual, applyProjectionFragmentEdit: mocks.applyProjectionFragmentEdit };
});

const projection: ManagedProjection = {
  entryKey: 'user-1%3Apersonal::topic::topic-1',
  record: {
    fragments: {
      display: { data: { title: 'Initial' }, observedAt: 10, source: 'network' },
    },
    id: 'topic-1',
    kind: 'topic',
  },
  scope: 'user-1:personal',
};

describe('useProjectionEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.applyProjectionFragmentEdit.mockResolvedValue(undefined);
  });

  it('applies parsed fragment data and refreshes the database snapshot', async () => {
    const onPersisted = vi.fn();
    const { result } = renderHook(() => useProjectionEditor({ onPersisted, projection }));

    act(() => result.current.setDraft('{"title":"Edited"}'));
    await act(() => result.current.apply());

    expect(mocks.applyProjectionFragmentEdit).toHaveBeenCalledWith({
      data: { title: 'Edited' },
      fragmentName: 'display',
      projection,
    });
    expect(onPersisted).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('persisted');
  });

  it('reports invalid JSON without invoking the Store commit', async () => {
    const { result } = renderHook(() => useProjectionEditor({ projection }));

    act(() => result.current.setDraft('{'));
    await act(() => result.current.apply());

    expect(mocks.applyProjectionFragmentEdit).not.toHaveBeenCalled();
    expect(result.current.phase).toBe('error');
    expect(result.current.message).toContain('valid JSON');
  });
});
