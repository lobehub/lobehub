/**
 * @vitest-environment happy-dom
 */
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import DocumentIdMode from './DocumentIdMode';

const handleContentChangeStore = vi.fn();
const performSave = vi.fn();
const flushSave = vi.fn();
const onEditorInit = vi.fn().mockResolvedValue(undefined);
const useFetchDocument = vi.fn(() => ({ error: undefined }));

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
});
