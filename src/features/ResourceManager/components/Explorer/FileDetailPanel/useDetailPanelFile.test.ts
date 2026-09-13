import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDetailPanelFile } from './useDetailPanelFile';

const mocks = vi.hoisted(() => ({
  fetchKnowledgeItem: vi.fn(),
  fileInList: undefined as { id: string; name: string } | undefined,
}));

vi.mock('@/store/file', () => ({
  fileManagerSelectors: {
    getFileById: () => () => mocks.fileInList,
  },
  useFileStore: (selector: (state: any) => unknown) =>
    selector({ useFetchKnowledgeItem: mocks.fetchKnowledgeItem }),
}));

describe('useDetailPanelFile', () => {
  beforeEach(() => {
    mocks.fileInList = undefined;
    mocks.fetchKnowledgeItem.mockReset();
  });

  it('returns the fetched item when the file is not in the loaded list', () => {
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

  it('returns nothing when no file is selected', () => {
    mocks.fetchKnowledgeItem.mockReturnValue({ data: undefined });

    const { result } = renderHook(() => useDetailPanelFile(undefined));

    expect(result.current).toBeUndefined();
  });
});
