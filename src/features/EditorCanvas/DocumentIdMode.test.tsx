/**
 * @vitest-environment happy-dom
 */
import type { IEditor } from '@lobehub/editor';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AsyncError from '@/components/AsyncError';
import { useDocumentStore } from '@/store/document';
import { editorSelectors } from '@/store/document/slices/editor';

import DocumentIdMode from './DocumentIdMode';
import InternalEditor from './InternalEditor';

const handleContentChangeStore = vi.fn();
const performSave = vi.fn();
const saveVersion = vi.fn();
const flushSave = vi.fn();
const onEditorInit = vi.fn().mockResolvedValue(undefined);
const createFetchDocumentResult = (
  overrides: Partial<{
    data: unknown;
    error: unknown;
    isLoading: boolean;
    mutate: ReturnType<typeof vi.fn>;
  }> = {},
) => ({ data: undefined, error: undefined, isLoading: false, mutate: vi.fn(), ...overrides });
const useFetchDocument = vi.fn(() => createFetchDocumentResult());

let saveHotkeyHandler: (() => void | Promise<void>) | undefined;

const mockDocumentStore = {
  flushSave,
  handleContentChange: handleContentChangeStore,
  onEditorInit,
  performSave,
  saveVersion,
  useFetchDocument,
};

vi.mock('zustand-utils', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createStoreUpdater: () => () => undefined,
}));

vi.mock('@/hooks/useHotkeys', () => ({
  useSaveDocumentHotkey: vi.fn((handler: () => void | Promise<void>) => {
    saveHotkeyHandler = handler;
  }),
}));

vi.mock('@/components/404', () => ({
  default: vi.fn(() => <div data-testid="not-found" />),
}));

vi.mock('@/components/AsyncError', () => ({
  default: vi.fn(() => <div data-testid="async-error" />),
}));

vi.mock('@/store/document', () => ({
  useDocumentStore: Object.assign(
    vi.fn((selector: (state: typeof mockDocumentStore) => unknown) => selector(mockDocumentStore)),
    {
      getState: vi.fn(() => ({ documents: {} })),
    },
  ),
}));

vi.mock('@/store/document/slices/editor', () => ({
  editorSelectors: {
    content: vi.fn(() => () => ''),
    isDirty: vi.fn(() => () => false),
    isDocumentLoading: vi.fn(() => () => false),
  },
}));

vi.mock('./InternalEditor', () => ({
  default: vi.fn(() => <div data-testid="internal-editor" />),
}));

vi.mock('./UnsavedChangesGuard', () => ({
  default: vi.fn(() => null),
}));

describe('DocumentIdMode', () => {
  beforeEach(() => {
    handleContentChangeStore.mockClear();
    performSave.mockClear();
    saveVersion.mockClear();
    flushSave.mockClear();
    onEditorInit.mockClear();
    useFetchDocument.mockClear();
    vi.mocked(editorSelectors.isDocumentLoading).mockReturnValue(() => false);
    vi.mocked(editorSelectors.content).mockImplementation(() => () => '');
    saveHotkeyHandler = undefined;
  });

  it('should save with manual source when save hotkey is triggered', async () => {
    render(
      <DocumentIdMode
        documentId="doc-1"
        editor={
          {
            getLexicalEditor: vi.fn(() => ({})),
          } as any
        }
      />,
    );

    expect(screen.getByTestId('internal-editor')).toBeInTheDocument();
    expect(saveHotkeyHandler).toBeDefined();

    await act(async () => {
      await saveHotkeyHandler?.();
    });

    expect(handleContentChangeStore).toHaveBeenCalledTimes(1);
    expect(saveVersion).toHaveBeenCalledWith('doc-1');
    expect(flushSave).not.toHaveBeenCalled();
  });

  it('should call external onInit after document hydration', async () => {
    const onInit = vi.fn();
    const editor = {
      getLexicalEditor: vi.fn(() => ({})),
    } as any;

    render(<DocumentIdMode documentId="doc-1" editor={editor} onInit={onInit} />);

    await waitFor(() => {
      expect(onEditorInit).toHaveBeenCalledWith(editor, 'doc-1');
      expect(onInit).toHaveBeenCalledWith(editor);
    });
  });

  describe('re-hydration on a new remote version', () => {
    const savedBody = { root: { children: [], type: 'root' } };
    const remoteBody = { root: { children: [{ type: 'heading' }], type: 'root' } };

    const renderAtVersion = (editor: any, version: string) => {
      useFetchDocument.mockReturnValue(
        createFetchDocumentResult({ data: { updatedAt: new Date(version) } }),
      );
      // A fresh `style` re-renders the memoized component, as the store subscription does.
      return <DocumentIdMode documentId="doc-1" editor={editor} style={{}} />;
    };

    afterEach(() => {
      useFetchDocument.mockImplementation(() => createFetchDocumentResult());
      vi.mocked(useDocumentStore.getState).mockReturnValue({ documents: {} } as any);
    });

    it('should not reset the editor when the new version is its own save', async () => {
      const editor = {
        getDocument: vi.fn(() => savedBody),
        getLexicalEditor: vi.fn(() => ({})),
      } as any;
      vi.mocked(useDocumentStore.getState).mockReturnValue({
        documents: { 'doc-1': { editorData: savedBody } },
      } as any);

      const { rerender } = render(renderAtVersion(editor, '2026-10-12T00:00:00Z'));
      await waitFor(() => expect(onEditorInit).toHaveBeenCalledTimes(1));

      // The autosave mirrors its row into the detail replica, bumping updatedAt.
      rerender(renderAtVersion(editor, '2026-10-12T00:00:05Z'));
      await act(async () => {});

      expect(onEditorInit).toHaveBeenCalledTimes(1);
    });

    it('should not hydrate again after the editor initialized through onInit', async () => {
      // The editor is not ready on the first render, so InternalEditor's onInit does the
      // first hydration and the mount effect bails out.
      let lexicalReady = false;
      const editor = {
        getDocument: vi.fn(() => savedBody),
        getLexicalEditor: vi.fn(() => (lexicalReady ? {} : undefined)),
      } as any;
      vi.mocked(useDocumentStore.getState).mockReturnValue({
        documents: { 'doc-1': { editorData: savedBody } },
      } as any);

      const { rerender } = render(renderAtVersion(editor, '2026-10-12T00:00:00Z'));
      expect(onEditorInit).not.toHaveBeenCalled();

      lexicalReady = true;
      act(() => {
        vi.mocked(InternalEditor).mock.lastCall![0].onInit!(editor);
      });
      expect(onEditorInit).toHaveBeenCalledTimes(1);

      // The autosave's version bump is the next render that re-reads isEditorInitialized.
      rerender(renderAtVersion(editor, '2026-10-12T00:00:05Z'));
      await act(async () => {});

      expect(onEditorInit).toHaveBeenCalledTimes(1);
    });

    it('should re-hydrate when a remote body replaced the stored one', async () => {
      const editor = {
        getDocument: vi.fn(() => savedBody),
        getLexicalEditor: vi.fn(() => ({})),
      } as any;
      vi.mocked(useDocumentStore.getState).mockReturnValue({
        documents: { 'doc-1': { editorData: remoteBody } },
      } as any);

      const { rerender } = render(renderAtVersion(editor, '2026-10-12T00:00:00Z'));
      await waitFor(() => expect(onEditorInit).toHaveBeenCalledTimes(1));

      rerender(renderAtVersion(editor, '2026-10-12T00:00:05Z'));

      await waitFor(() => expect(onEditorInit).toHaveBeenCalledTimes(2));
    });
  });

  it('should pass topicId into document fetching options', () => {
    const editor = {
      getLexicalEditor: vi.fn(() => ({})),
    } as any;

    render(
      <DocumentIdMode documentId="doc-1" editor={editor} sourceType="notebook" topicId="topic-1" />,
    );

    expect(useFetchDocument).toHaveBeenCalledWith('doc-1', {
      autoSave: true,
      editor,
      sourceType: 'notebook',
      topicId: 'topic-1',
    });
  });

  it('should render a fetch error before the document loading gate', () => {
    const editor = {
      getLexicalEditor: vi.fn(() => ({})),
    } as any;
    useFetchDocument.mockReturnValueOnce({
      ...createFetchDocumentResult(),
      error: new Error('load failed'),
    });
    vi.mocked(editorSelectors.isDocumentLoading).mockReturnValueOnce(() => true);

    render(<DocumentIdMode documentId="doc-1" editor={editor} />);

    expect(screen.getByTestId('async-error')).toBeInTheDocument();
    expect(screen.queryByTestId('internal-editor')).not.toBeInTheDocument();
  });

  it('should explain missing access instead of a load failure on FORBIDDEN', () => {
    const editor = {
      getLexicalEditor: vi.fn(() => ({})),
    } as any;
    useFetchDocument.mockReturnValueOnce({
      ...createFetchDocumentResult(),
      error: Object.assign(new Error('forbidden'), { data: { code: 'FORBIDDEN' } }),
    });
    vi.mocked(editorSelectors.isDocumentLoading).mockReturnValueOnce(() => true);

    render(<DocumentIdMode documentId="doc-1" editor={editor} />);

    expect(screen.queryByTestId('not-found')).not.toBeInTheDocument();
    expect(vi.mocked(AsyncError).mock.lastCall?.[0]).toEqual(
      expect.objectContaining({
        description: 'pageEditor.noAccess.description',
        title: 'pageEditor.noAccess.title',
      }),
    );
  });

  it('should render not found when the document fetch resolves to null', () => {
    const editor = {
      getLexicalEditor: vi.fn(() => ({})),
    } as any;
    useFetchDocument.mockReturnValueOnce({
      ...createFetchDocumentResult(),
      data: null,
    });
    vi.mocked(editorSelectors.isDocumentLoading).mockReturnValueOnce(() => true);

    render(<DocumentIdMode documentId="doc-1" editor={editor} />);

    expect(screen.getByTestId('not-found')).toBeInTheDocument();
    expect(screen.queryByTestId('internal-editor')).not.toBeInTheDocument();
  });
  it('shows the pending body over the mounted editor until the room body arrives', () => {
    const editor = { getLexicalEditor: vi.fn(() => ({})) } as any;
    const { rerender } = render(
      <DocumentIdMode
        collab
        documentId="doc-1"
        editor={editor}
        pendingBody={<div data-testid="pending-body" />}
      />,
    );

    expect(screen.getByTestId('pending-body')).toBeInTheDocument();
    expect(screen.getByTestId('internal-editor')).not.toBeVisible();

    rerender(<DocumentIdMode collab documentId="doc-1" editor={editor} />);

    expect(screen.queryByTestId('pending-body')).not.toBeInTheDocument();
    expect(screen.getByTestId('internal-editor')).toBeVisible();
  });

  describe('long bodies', () => {
    const LONG_BODY = 'x'.repeat(50_000);
    // Only readiness is read on these paths.
    const editor = { getLexicalEditor: vi.fn(() => ({})) } as unknown as IEditor;
    const sleep = (ms: number) => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, ms);
      return promise;
    };

    beforeEach(() => {
      vi.mocked(editorSelectors.content).mockImplementation(
        (id) => () => (id === 'doc-long' ? LONG_BODY : ''),
      );
    });

    it('loads a long body after the switch paints, behind a skeleton', async () => {
      render(<DocumentIdMode documentId="doc-long" editor={editor} />);

      // The switch commits without building the body; the previous one stays hidden.
      expect(onEditorInit).not.toHaveBeenCalled();
      expect(screen.getByTestId('internal-editor')).not.toBeVisible();

      await waitFor(() => expect(onEditorInit).toHaveBeenCalledWith(editor, 'doc-long'));
      await waitFor(() => expect(screen.getByTestId('internal-editor')).toBeVisible());
    });

    it('keeps the atomic swap for a short body', () => {
      render(<DocumentIdMode documentId="doc-short" editor={editor} />);

      expect(onEditorInit).toHaveBeenCalledWith(editor, 'doc-short');
      expect(screen.getByTestId('internal-editor')).toBeVisible();
    });

    it('drops a long body left before it loaded, and loads it on return', async () => {
      const { rerender } = render(<DocumentIdMode documentId="doc-long" editor={editor} />);
      rerender(<DocumentIdMode documentId="doc-short" editor={editor} />);

      // Wait past the frame the long body was scheduled for.
      await act(() => sleep(50));
      expect(onEditorInit).toHaveBeenCalledTimes(1);
      expect(onEditorInit).toHaveBeenLastCalledWith(editor, 'doc-short');

      rerender(<DocumentIdMode documentId="doc-long" editor={editor} />);

      await waitFor(() => expect(onEditorInit).toHaveBeenLastCalledWith(editor, 'doc-long'));
      expect(onEditorInit).toHaveBeenCalledTimes(2);
    });
  });
});
