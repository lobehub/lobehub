/**
 * @vitest-environment happy-dom
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { editorSelectors } from '@/store/document/slices/editor';

import DocumentIdMode from './DocumentIdMode';

const handleContentChangeStore = vi.fn();
const performSave = vi.fn();
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
  useFetchDocument,
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('zustand-utils', () => ({
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
  default: vi.fn(() => <div data-testid="internal-editor" />),
}));

vi.mock('./UnsavedChangesGuard', () => ({
  default: vi.fn(() => null),
}));

describe('DocumentIdMode', () => {
  beforeEach(() => {
    handleContentChangeStore.mockClear();
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
