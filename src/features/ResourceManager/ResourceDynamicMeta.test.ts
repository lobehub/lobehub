import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useFileStore } from '@/store/file';
import { useKnowledgeBaseStore } from '@/store/library';
import { usePageStore } from '@/store/page';
import type { LobeDocument } from '@/types/document';
import type { FileListItem } from '@/types/files';
import type { KnowledgeBaseItem } from '@/types/knowledgeBase';

import { useDocsItemTitle, useLibraryTitle } from './ResourceDynamicMeta';

const seedPage = (id: string, title: string) =>
  usePageStore.setState({ pageDetailMap: { [id]: { id, title } as LobeDocument } });

const seedDocument = (id: string, title: string) =>
  useFileStore.setState({ documentMap: { [id]: { document: { id, title } as LobeDocument } } });

describe('useDocsItemTitle', () => {
  afterEach(() => {
    usePageStore.setState({ pageDetailMap: {} });
    useFileStore.setState({ documentMap: {}, fileDetailMap: {} });
  });

  it('titles /resource/page/:id after the page, resolving the short id', () => {
    seedPage('docs_abc', 'Replacing a UI Library Without a Freeze');

    const { result } = renderHook(() => useDocsItemTitle({ id: 'abc' }));

    expect(result.current).toBe('Replacing a UI Library Without a Freeze');
  });

  it('prefers the document replica over the sidebar row', () => {
    seedPage('docs_abc', 'Old title');
    seedDocument('docs_abc', 'Renamed title');

    const { result } = renderHook(() => useDocsItemTitle({ id: 'abc' }));

    expect(result.current).toBe('Renamed title');
  });

  it('titles /resource/file/:id after the file name', () => {
    useFileStore.setState({
      fileDetailMap: { file_1: { file: { id: 'file_1', name: 'report.pdf' } as FileListItem } },
    });

    const { result } = renderHook(() => useDocsItemTitle({ id: 'file_1' }));

    expect(result.current).toBe('report.pdf');
  });

  it('has no title before the item loads', () => {
    const { result } = renderHook(() => useDocsItemTitle({ id: 'abc' }));

    expect(result.current).toBeUndefined();
  });
});

describe('useLibraryTitle', () => {
  afterEach(() => {
    useKnowledgeBaseStore.setState({ knowledgeBaseDetailMap: {} });
    useFileStore.setState({ documentMap: {}, folderBreadcrumbMap: {} });
  });

  const seedLibrary = () => {
    useKnowledgeBaseStore.setState({
      knowledgeBaseDetailMap: { kb_1: { id: 'kb_1', name: 'Research' } as KnowledgeBaseItem },
    });
    useFileStore.setState({
      folderBreadcrumbMap: {
        docs_folder: [
          { id: 'docs_parent', name: 'Archive', slug: 'docs_parent' },
          { id: 'docs_folder', name: 'Q3 Notes', slug: 'docs_folder' },
        ],
      },
    });
    seedDocument('docs_item', 'Interview summary');
  };

  it.each([
    ['the library', { id: 'kb_1' }, 'Research'],
    ['the opened folder', { folderId: 'docs_folder', id: 'kb_1' }, 'Q3 Notes'],
    ['the opened item', { id: 'kb_1', itemId: 'docs_item' }, 'Interview summary'],
  ])('titles a library route after %s', (_, params, title) => {
    seedLibrary();

    const { result } = renderHook(() => useLibraryTitle(params));

    expect(result.current).toBe(title);
  });
});
