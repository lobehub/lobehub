import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMarkdownExport } from './useMarkdownExport';

const mocks = vi.hoisted(() => ({
  documentMeta: undefined as Record<string, unknown> | undefined,
  storeContent: undefined as string | undefined,
  toastSuccess: vi.fn(),
}));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isDesktop: false,
}));

vi.mock('@lobehub/ui', () => ({
  toast: { error: vi.fn(), success: mocks.toastSuccess },
}));

vi.mock('@/store/document', () => ({
  useDocumentStore: (selector: (s: unknown) => unknown) =>
    selector({
      documents: { doc_1: { content: mocks.storeContent } },
      useFetchDocumentDetail: () => ({ data: mocks.documentMeta }),
    }),
}));

describe('useMarkdownExport', () => {
  beforeEach(() => {
    mocks.documentMeta = { content: 'saved', filename: 'brief.md', title: 'Launch Brief' };
    mocks.storeContent = undefined;
    vi.clearAllMocks();
  });

  it('is unavailable until the document loads', () => {
    mocks.documentMeta = undefined;
    const { result } = renderHook(() => useMarkdownExport('doc_1'));

    expect(result.current).toBeUndefined();
  });

  // A file-backed document keeps its data behind `fileId`; its markdown is empty.
  it('is unavailable for a file-backed document', () => {
    mocks.documentMeta = { content: '', fileId: 'file_1', filename: 'source.pdf' };
    const { result } = renderHook(() => useMarkdownExport('doc_1'));

    expect(result.current).toBeUndefined();
  });

  it('downloads the live editor buffer under the document title', async () => {
    mocks.storeContent = 'live edit';
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:doc');
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const { result } = renderHook(() => useMarkdownExport('doc_1'));
    await act(() => result.current!());

    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe('Launch Brief.md');
    expect(await createObjectURL.mock.calls[0][0].text()).toBe('live edit');
    expect(mocks.toastSuccess).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it('does not double the extension of a title that already ends in .md', async () => {
    mocks.documentMeta = { content: 'saved', filename: 'notes.md', title: 'Week 10 notes.md' };
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:doc'), revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const { result } = renderHook(() => useMarkdownExport('doc_1'));
    await act(() => result.current!());

    expect((click.mock.contexts.at(-1) as HTMLAnchorElement).download).toBe('Week 10 notes.md');
    vi.unstubAllGlobals();
  });
});
