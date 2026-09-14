/**
 * @vitest-environment happy-dom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { editorSelectors } from '@/store/document/slices/editor';

import DocumentIdMode from './DocumentIdMode';

const handleContentChangeStore = vi.fn();
const cancelDebouncedSave = vi.fn();
const performSave = vi.fn();
const flushSave = vi.fn();
const onEditorInit = vi.fn().mockResolvedValue(undefined);
const createFetchDocumentResult = (
  overrides: Partial<{
    data: unknown;
    error: unknown;
    hasFreshData: boolean;
    isLoading: boolean;
    isValidating: boolean;
    mutate: ReturnType<typeof vi.fn>;
  }> = {},
) => ({
  data: undefined,
  error: undefined,
  hasFreshData: true,
  isLoading: false,
  isValidating: false,
  mutate: vi.fn(),
  ...overrides,
});
const useFetchDocument = vi.fn(() => createFetchDocumentResult());

let saveHotkeyHandler: (() => void | Promise<void>) | undefined;

const mockDocumentStore = {
  cancelDebouncedSave,
  flushSave,
  handleContentChange: handleContentChangeStore,
  onEditorInit,
  performSave,
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
    isDirty: vi.fn(() => () => false),
    isDocumentLoading: vi.fn(() => () => false),
  },
}));

vi.mock('./InternalEditor', () => ({
  default: vi.fn(
    ({
      editor,
      onContentChange,
      onInit,
    }: {
      editor: unknown;
      onContentChange?: () => void;
      onInit?: (editor: unknown) => void;
    }) => (
      <>
        <button data-testid="internal-editor" onClick={() => onInit?.(editor)} />
        <button data-testid="internal-editor-content-change" onClick={() => onContentChange?.()} />
      </>
    ),
  ),
}));

vi.mock('./UnsavedChangesGuard', () => ({
  default: vi.fn(() => null),
}));

describe('DocumentIdMode', () => {
  beforeEach(() => {
    handleContentChangeStore.mockClear();
    cancelDebouncedSave.mockClear();
    performSave.mockClear();
    flushSave.mockClear();
    onEditorInit.mockClear();
    useFetchDocument.mockClear();
    vi.mocked(editorSelectors.isDocumentLoading).mockReturnValue(() => false);
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
    expect(performSave).toHaveBeenCalledWith('doc-1', undefined, { saveSource: 'manual' });
    expect(flushSave).not.toHaveBeenCalled();
  });

  it('should call external onInit after document hydration', async () => {
    const onInit = vi.fn();
    const editor = {
      getLexicalEditor: vi.fn(() => ({})),
    } as any;

    render(<DocumentIdMode documentId="doc-1" editor={editor} onInit={onInit} />);

    await waitFor(() => {
      expect(onEditorInit).toHaveBeenCalledWith(editor);
      expect(onInit).toHaveBeenCalledWith(editor);
    });
  });

  it('should apply one snapshot when both editor init paths fire', async () => {
    const editor = {
      getLexicalEditor: vi.fn(() => ({})),
    } as any;

    render(<DocumentIdMode documentId="doc-1" editor={editor} />);

    await waitFor(() => expect(onEditorInit).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId('internal-editor'));

    expect(onEditorInit).toHaveBeenCalledTimes(1);
  });

  it('should not re-apply autosave echoes while collaboration owns live state', async () => {
    const editor = {
      getLexicalEditor: vi.fn(() => ({})),
    } as any;
    useFetchDocument.mockReturnValue({
      ...createFetchDocumentResult(),
      data: { updatedAt: new Date('2026-08-16T00:00:00.000Z') },
    });

    const { rerender } = render(
      <DocumentIdMode collaborationEnabled documentId="doc-1" editor={editor} />,
    );

    await waitFor(() => expect(onEditorInit).toHaveBeenCalledTimes(1));

    useFetchDocument.mockReturnValue({
      ...createFetchDocumentResult(),
      data: { updatedAt: new Date('2026-08-16T00:00:01.000Z') },
    });
    rerender(
      <DocumentIdMode
        collaborationEnabled
        documentId="doc-1"
        editor={editor}
        placeholder="autosave echo"
      />,
    );

    expect(onEditorInit).toHaveBeenCalledTimes(1);
  });

  it('disables legacy content autosave before a collaboration room is ready', () => {
    const editor = {
      getLexicalEditor: vi.fn(() => ({})),
    } as any;

    render(
      <DocumentIdMode
        collaborationRequired
        documentId="doc-1"
        editor={editor}
        onContentChange={vi.fn()}
      />,
    );

    expect(useFetchDocument).toHaveBeenCalledWith('doc-1', {
      autoSave: false,
      editor,
      sourceType: 'page',
      topicId: undefined,
    });
  });

  it('cancels a queued legacy autosave during collaboration handoff', () => {
    const editor = {
      getLexicalEditor: vi.fn(() => ({})),
    } as any;

    render(<DocumentIdMode collaborationRequired documentId="doc-1" editor={editor} />);

    expect(cancelDebouncedSave).toHaveBeenCalledWith('doc-1');
  });

  it('does not mirror collaborative body changes into the legacy document store', () => {
    const editor = {
      getLexicalEditor: vi.fn(() => ({})),
    } as any;
    const onContentChange = vi.fn();

    render(
      <DocumentIdMode
        collaborationEnabled
        collaborationRequired
        documentId="doc-1"
        editor={editor}
        onContentChange={onContentChange}
      />,
    );

    fireEvent.click(screen.getByTestId('internal-editor-content-change'));

    expect(handleContentChangeStore).not.toHaveBeenCalled();
    expect(onContentChange).toHaveBeenCalledTimes(1);
  });

  it('should wait for fresh server data before bootstrapping a revisited collaboration room', async () => {
    const editor = {
      getLexicalEditor: vi.fn(() => ({})),
    } as any;
    useFetchDocument.mockReturnValue({
      ...createFetchDocumentResult(),
      data: { updatedAt: new Date('2026-08-16T00:00:00.000Z') },
      hasFreshData: false,
    });

    const { rerender } = render(
      <DocumentIdMode collaborationEnabled documentId="doc-1" editor={editor} />,
    );

    expect(screen.queryByTestId('internal-editor')).not.toBeInTheDocument();
    expect(onEditorInit).not.toHaveBeenCalled();

    useFetchDocument.mockReturnValue({
      ...createFetchDocumentResult(),
      data: { updatedAt: new Date('2026-08-16T00:00:01.000Z') },
    });
    rerender(
      <DocumentIdMode
        collaborationEnabled
        documentId="doc-1"
        editor={editor}
        placeholder="fresh snapshot"
      />,
    );

    await waitFor(() => expect(onEditorInit).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('internal-editor')).toBeInTheDocument();
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
});
