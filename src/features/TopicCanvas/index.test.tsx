import { render, screen, waitFor } from '@testing-library/react';
import type * as React from 'react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { documentHistoryQueueService } from '@/services/documentHistoryQueue';

import TopicCanvas from './index';

const mockEditor = {
  dataTypeMap: new Map([
    ['json', {}],
    ['litexml', {}],
    ['markdown', {}],
  ]),
  focus: vi.fn(),
  getDocument: vi.fn(() => ({ root: true })),
  getLexicalEditor: vi.fn(() => ({})),
} as const;

const runtimeSpies = vi.hoisted(() => ({
  setBeforeMutateHandler: vi.fn(),
  setCurrentDocId: vi.fn(),
  setEditor: vi.fn(),
  setTitleHandlers: vi.fn(),
}));

const useEditorMock = vi.hoisted(() => vi.fn(() => mockEditor));

vi.mock('@lobehub/editor/react', () => ({
  EditorProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useEditor: useEditorMock,
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
  TextArea: ({
    value,
    onChange,
  }: {
    onChange?: (event: { target: { value: string } }) => void;
    value?: string;
  }) => (
    <textarea
      data-testid="topic-title-input"
      value={value ?? ''}
      onChange={(event) => onChange?.({ target: { value: event.target.value } })}
    />
  ),
}));

vi.mock('@/features/EditorCanvas', async () => {
  const ReactActual = (await vi.importActual('react')) as typeof React;

  return {
    DiffAllToolbar: ({ documentId, editor }: { documentId: string; editor: typeof mockEditor }) => (
      <div
        data-document-id={documentId}
        data-editor={editor === mockEditor ? 'shared' : 'other'}
        data-testid="diff-toolbar"
      />
    ),
    EditorCanvas: ({
      documentId,
      editor,
      onInit,
    }: {
      documentId?: string;
      editor?: typeof mockEditor;
      onInit?: (editor: typeof mockEditor) => void;
    }) => {
      ReactActual.useEffect(() => {
        if (editor) onInit?.(editor);
      }, [editor, onInit]);

      return (
        <div
          data-document-id={documentId ?? ''}
          data-editor={editor === mockEditor ? 'shared' : 'other'}
          data-testid="editor-canvas"
        />
      );
    },
  };
});

vi.mock('@/features/WideScreenContainer', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/hooks/useHotkeys', () => ({
  useRegisterFilesHotkeys: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/services/documentHistoryQueue', () => ({
  documentHistoryQueueService: {
    enqueue: vi.fn(),
    enqueueEditorSnapshot: vi.fn(),
    flush: vi.fn(),
  },
}));

vi.mock('@/store/tool/slices/builtin/executors/lobe-page-agent', () => ({
  pageAgentRuntime: runtimeSpies,
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('TopicCanvas', () => {
  it('mounts diff toolbar and page-agent runtime bridge for the current document', async () => {
    const { unmount } = render(
      <TopicCanvas documentId="doc-1" title="Topic Title" onTitleChange={vi.fn()} />,
    );

    expect(screen.getByTestId('editor-canvas')).toHaveAttribute('data-document-id', 'doc-1');
    expect(screen.getByTestId('diff-toolbar')).toHaveAttribute('data-document-id', 'doc-1');
    expect(screen.getByTestId('diff-toolbar')).toHaveAttribute('data-editor', 'shared');

    await waitFor(() => {
      expect(runtimeSpies.setEditor).toHaveBeenCalledWith(mockEditor);
      expect(runtimeSpies.setCurrentDocId).toHaveBeenCalledWith('doc-1');
      expect(runtimeSpies.setTitleHandlers).toHaveBeenCalledTimes(1);
      expect(runtimeSpies.setBeforeMutateHandler).toHaveBeenCalledWith(expect.any(Function));
    });

    const beforeMutateHandler = runtimeSpies.setBeforeMutateHandler.mock.calls.find(
      ([handler]) => typeof handler === 'function',
    )?.[0] as (() => void) | undefined;
    beforeMutateHandler?.();

    expect(documentHistoryQueueService.enqueueEditorSnapshot).toHaveBeenCalledWith({
      documentId: 'doc-1',
      editor: mockEditor,
    });

    unmount();

    expect(runtimeSpies.setCurrentDocId).toHaveBeenLastCalledWith(undefined);
    expect(runtimeSpies.setTitleHandlers).toHaveBeenLastCalledWith(null, null);
    expect(runtimeSpies.setBeforeMutateHandler).toHaveBeenLastCalledWith(null);
    expect(runtimeSpies.setEditor).toHaveBeenLastCalledWith(null);
  });
});
