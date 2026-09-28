/**
 * @vitest-environment happy-dom
 */
import { type IEditor } from '@lobehub/editor';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EditorCanvas } from './EditorCanvas';
import type { EditorDataModeProps } from './EditorDataMode';

// Mock DocumentIdMode
vi.mock('./DocumentIdMode', () => ({
  default: vi.fn(({ documentId }) => (
    <div data-testid="document-id-mode">DocumentIdMode: {documentId}</div>
  )),
}));

// Mock EditorDataMode
vi.mock('./EditorDataMode', () => ({
  default: vi.fn(({ editorData }) => (
    <div data-testid="editor-data-mode">EditorDataMode: {editorData?.content}</div>
  )),
}));

// Mock InternalEditor
vi.mock('./InternalEditor', () => ({
  default: vi.fn(() => <div data-testid="internal-editor">InternalEditor</div>),
}));

// Mock SafeBoundary to pass through children
vi.mock('@/components/ErrorBoundary', () => ({
  default: vi.fn(({ children }) => <>{children}</>),
}));

describe('EditorCanvas', () => {
  let mockEditor: IEditor;

  beforeEach(() => {
    mockEditor = {
      getDocument: vi.fn(),
      setDocument: vi.fn(),
      focus: vi.fn(),
    } as unknown as IEditor;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('mode selection', () => {
    it('should render DocumentIdMode when documentId is provided', () => {
      render(<EditorCanvas documentId="doc-123" editor={mockEditor} />);

      expect(screen.getByTestId('document-id-mode')).toBeInTheDocument();
      expect(screen.getByText('DocumentIdMode: doc-123')).toBeInTheDocument();
      expect(screen.queryByTestId('editor-data-mode')).not.toBeInTheDocument();
      expect(screen.queryByTestId('internal-editor')).not.toBeInTheDocument();
    });

    it('should render EditorDataMode when editorData is provided', () => {
      render(<EditorCanvas editor={mockEditor} editorData={{ content: 'test content' }} />);

      expect(screen.getByTestId('editor-data-mode')).toBeInTheDocument();
      expect(screen.getByText('EditorDataMode: test content')).toBeInTheDocument();
      expect(screen.queryByTestId('document-id-mode')).not.toBeInTheDocument();
      expect(screen.queryByTestId('internal-editor')).not.toBeInTheDocument();
    });

    it('should render InternalEditor in basic mode (no documentId or editorData)', () => {
      render(<EditorCanvas editor={mockEditor} />);

      expect(screen.getByTestId('internal-editor')).toBeInTheDocument();
      expect(screen.queryByTestId('document-id-mode')).not.toBeInTheDocument();
      expect(screen.queryByTestId('editor-data-mode')).not.toBeInTheDocument();
    });

    it('should return null in basic mode when editor is undefined', () => {
      const { container } = render(<EditorCanvas editor={undefined} />);

      expect(container.firstChild).toBeNull();
    });
  });

  describe('mode priority', () => {
    it('should prioritize documentId over editorData when both are provided', () => {
      render(
        <EditorCanvas
          documentId="doc-123"
          editor={mockEditor}
          editorData={{ content: 'test content' }}
        />,
      );

      expect(screen.getByTestId('document-id-mode')).toBeInTheDocument();
      expect(screen.queryByTestId('editor-data-mode')).not.toBeInTheDocument();
    });
  });

  describe('props forwarding', () => {
    it('should forward props to DocumentIdMode', async () => {
      const onContentChange = vi.fn();
      const onInit = vi.fn();

      render(
        <EditorCanvas
          autoSave={false}
          documentId="doc-123"
          editor={mockEditor}
          placeholder="Custom placeholder"
          sourceType="notebook"
          topicId="topic-123"
          unsavedChangesGuard={{ enabled: true, message: 'unsaved', title: 'Unsaved' }}
          onContentChange={onContentChange}
          onInit={onInit}
        />,
      );

      const DocumentIdMode = await vi.importMock('./DocumentIdMode');
      const lastCall = (DocumentIdMode.default as ReturnType<typeof vi.fn>).mock.calls.at(-1);

      expect(lastCall?.[0]).toMatchObject({
        autoSave: false,
        documentId: 'doc-123',
        editor: mockEditor,
        onContentChange,
        onInit,
        placeholder: 'Custom placeholder',
        sourceType: 'notebook',
        topicId: 'topic-123',
        unsavedChangesGuard: { enabled: true, message: 'unsaved', title: 'Unsaved' },
      });
    });

    it('should forward props to EditorDataMode', async () => {
      const onContentChange = vi.fn();
      const onInit = vi.fn();
      const editorData = { content: 'test', editorData: { blocks: [] } };
      const mentionOption = { items: [] };
      const getPopupContainer = vi.fn(() => null);

      render(
        <EditorCanvas
          contentRevision={3}
          contentStyle={{ minHeight: 44, padding: 0 }}
          editor={mockEditor}
          editorData={editorData}
          getPopupContainer={getPopupContainer}
          mentionOption={mentionOption}
          placeholder="Custom placeholder"
          onContentChange={onContentChange}
          onInit={onInit}
        />,
      );

      const EditorDataMode = await vi.importMock('./EditorDataMode');
      const lastCall = (EditorDataMode.default as ReturnType<typeof vi.fn>).mock.calls.at(-1);

      expect(lastCall?.[0]).toMatchObject({
        contentRevision: 3,
        contentStyle: { minHeight: 44, padding: 0 },
        editor: mockEditor,
        editorData,
        getPopupContainer,
        mentionOption,
        onContentChange,
        onInit,
        placeholder: 'Custom placeholder',
      });
    });

    it('should reload same-entity content only when its authoritative revision changes', async () => {
      const editorDataModeModule = (await vi.importActual('./EditorDataMode')) as {
        default: ComponentType<EditorDataModeProps>;
      };
      const ActualEditorDataMode = editorDataModeModule.default;

      const { rerender } = render(
        <ActualEditorDataMode
          contentRevision={0}
          editor={mockEditor}
          editorData={{ content: 'Old instruction' }}
          entityId="T-1"
        />,
      );

      const InternalEditor = await vi.importMock('./InternalEditor');
      const onInit = (InternalEditor.default as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]
        .onInit;
      act(() => onInit?.(mockEditor));
      vi.mocked(mockEditor.setDocument).mockClear();

      rerender(
        <ActualEditorDataMode
          contentRevision={0}
          editor={mockEditor}
          editorData={{ content: 'Old instruction' }}
          entityId="T-1"
        />,
      );
      expect(mockEditor.setDocument).not.toHaveBeenCalled();

      // A refetch or local autosave can replace the props while the revision
      // stays stable. Never inspect/reload the live document in that case.
      rerender(
        <ActualEditorDataMode
          contentRevision={0}
          editor={mockEditor}
          editorData={{ content: 'New instruction' }}
          entityId="T-1"
        />,
      );
      expect(mockEditor.setDocument).not.toHaveBeenCalled();
      expect(mockEditor.getDocument).not.toHaveBeenCalled();

      rerender(
        <ActualEditorDataMode
          contentRevision={1}
          editor={mockEditor}
          editorData={{ content: 'New instruction' }}
          entityId="T-1"
        />,
      );

      await waitFor(() => {
        expect(mockEditor.setDocument).toHaveBeenCalledWith('markdown', 'New instruction', {
          keepId: true,
        });
      });
    });

    it('should forward props to InternalEditor in basic mode', async () => {
      const onContentChange = vi.fn();
      const onInit = vi.fn();
      const mentionOption = { items: [] };

      render(
        <EditorCanvas
          editor={mockEditor}
          floatingToolbar={false}
          mentionOption={mentionOption}
          placeholder="Custom placeholder"
          onContentChange={onContentChange}
          onInit={onInit}
        />,
      );

      const InternalEditor = await vi.importMock('./InternalEditor');
      const lastCall = (InternalEditor.default as ReturnType<typeof vi.fn>).mock.calls.at(-1);

      expect(lastCall?.[0]).toMatchObject({
        editor: mockEditor,
        floatingToolbar: false,
        mentionOption,
        onContentChange,
        onInit,
        placeholder: 'Custom placeholder',
      });
    });
  });

  describe('error boundary wrapping', () => {
    it('should wrap DocumentIdMode with SafeBoundary', async () => {
      render(<EditorCanvas documentId="doc-123" editor={mockEditor} />);

      const SafeBoundary = await vi.importMock('@/components/ErrorBoundary');
      expect(SafeBoundary.default).toHaveBeenCalled();
    });

    it('should wrap EditorDataMode with SafeBoundary', async () => {
      render(<EditorCanvas editor={mockEditor} editorData={{ content: 'test' }} />);

      const SafeBoundary = await vi.importMock('@/components/ErrorBoundary');
      expect(SafeBoundary.default).toHaveBeenCalled();
    });

    it('should wrap InternalEditor with SafeBoundary in basic mode', async () => {
      render(<EditorCanvas editor={mockEditor} />);

      const SafeBoundary = await vi.importMock('@/components/ErrorBoundary');
      expect(SafeBoundary.default).toHaveBeenCalled();
    });
  });
});
