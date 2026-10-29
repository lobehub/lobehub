/**
 * @vitest-environment happy-dom
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { lambdaClient } from '@/libs/trpc/client';
import { useFileStore } from '@/store/file';

import { useLibraryItemBackPath } from './useLibraryItemBackPath';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    document: { getDocumentById: { query: vi.fn() } },
    file: { getFileItemById: { query: vi.fn() } },
  },
}));

const MutateBridge = () => {
  const { mutate } = useSWRConfig();
  useEffect(() => setScopedMutate(mutate), [mutate]);
  return null;
};

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(
    SWRConfig,
    { value: { dedupingInterval: 0, provider: () => new Map() } },
    createElement(MutateBridge),
    children,
  );

const doc = (id: string, fields: { parentId?: string | null }) => ({
  createdAt: new Date(0),
  fileType: 'custom/document',
  id,
  parentId: fields.parentId ?? null,
  title: id,
  updatedAt: new Date(0),
});

/** @example Back from a library item returns to the folder that holds it. */
describe('useLibraryItemBackPath', () => {
  beforeEach(() => {
    vi.spyOn(cacheScope, 'get').mockReturnValue('test:personal');
    vi.spyOn(cacheScope, 'use').mockReturnValue('test:personal');
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(false);
    act(() => useFileStore.setState({ fileDetailMap: {} }));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  // ROOT CAUSE:
  //
  // Library items moved from `/resource/library/<kb>/<folder>?file=<id>` to
  // `/resource/library/<kb>/docs/<id>`, so the path no longer names the folder
  // and Back landed on the library root instead of the item's folder.
  it('returns to the folder of a deep-linked page', async () => {
    vi.mocked(lambdaClient.document.getDocumentById.query).mockResolvedValue(
      doc('docs_page', { parentId: 'docs_folder' }) as any,
    );

    const { result } = renderHook(() => useLibraryItemBackPath('kb_1', 'docs_page'), { wrapper });

    await waitFor(() => expect(result.current).toBe('/resource/library/kb_1/folder/docs_folder'));
  });

  it('returns to the folder of an uploaded file', async () => {
    vi.mocked(lambdaClient.file.getFileItemById.query).mockResolvedValue({
      id: 'file_1',
      name: 'a.pdf',
      parentId: 'docs_folder',
    } as any);

    const { result } = renderHook(() => useLibraryItemBackPath('kb_1', 'file_1'), { wrapper });

    await waitFor(() => expect(result.current).toBe('/resource/library/kb_1/folder/docs_folder'));
  });

  it('returns the library root for an item at the top level', async () => {
    vi.mocked(lambdaClient.file.getFileItemById.query).mockResolvedValue({
      id: 'file_1',
      name: 'a.pdf',
      parentId: null,
    } as any);

    const { result } = renderHook(() => useLibraryItemBackPath('kb_1', 'file_1'), { wrapper });

    await waitFor(() =>
      expect(useFileStore.getState().fileDetailMap['file_1']?.file).toBeDefined(),
    );
    expect(result.current).toBe('/resource/library/kb_1');
  });
});
