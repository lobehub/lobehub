import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDetailPanelFile } from './useDetailPanelFile';

const mocks = vi.hoisted(() => ({
  fetchKnowledgeItem: vi.fn(),
  fileInList: undefined as { id: string; name: string } | undefined,
  resourceMap: new Map<string, { id: string; name: string }>(),
}));

vi.mock('@/store/file', () => ({
  fileManagerSelectors: {
    getFileById: () => () => mocks.fileInList,
  },
  useFileStore: (selector: (state: any) => unknown) =>
    selector({ resourceMap: mocks.resourceMap, useFetchKnowledgeItem: mocks.fetchKnowledgeItem }),
}));

describe('useDetailPanelFile', () => {
  beforeEach(() => {
    mocks.fileInList = undefined;
    mocks.resourceMap = new Map();
    mocks.fetchKnowledgeItem.mockReset();
  });

  it('returns the fetched item when the file is not loaded anywhere', () => {
    mocks.fetchKnowledgeItem.mockReturnValue({
      data: { id: 'resource-1', name: 'analysis-report.md' },
    });

    const { result } = renderHook(() => useDetailPanelFile('resource-1'));

    expect(mocks.fetchKnowledgeItem).toHaveBeenCalledWith('resource-1');
    expect(result.current).toEqual({ id: 'resource-1', name: 'analysis-report.md' });
  });

  it('uses the loaded list entry and skips the request', () => {
    mocks.fileInList = { id: 'resource-1', name: 'final.pdf' };
    mocks.fetchKnowledgeItem.mockReturnValue({ data: undefined });

    const { result } = renderHook(() => useDetailPanelFile('resource-1'));

    expect(mocks.fetchKnowledgeItem).toHaveBeenCalledWith(undefined);
    expect(result.current).toEqual({ id: 'resource-1', name: 'final.pdf' });
  });

  it('uses the explorer resource row and skips the request', () => {
    mocks.resourceMap.set('docs_1', { id: 'docs_1', name: 'detail-panel-notes.md' });
    mocks.fetchKnowledgeItem.mockReturnValue({ data: undefined });

    const { result } = renderHook(() => useDetailPanelFile('docs_1'));

    // Explorer rows are only in `resourceMap`; missing it rendered a blank panel
    // until a duplicate request for an already visible row came back.
    expect(mocks.fetchKnowledgeItem).toHaveBeenCalledWith(undefined);
    expect(result.current).toEqual({ id: 'docs_1', name: 'detail-panel-notes.md' });
  });

  it('returns nothing when no file is selected', () => {
    mocks.fetchKnowledgeItem.mockReturnValue({ data: undefined });

    const { result } = renderHook(() => useDetailPanelFile(undefined));

    expect(result.current).toBeUndefined();
  });
});
