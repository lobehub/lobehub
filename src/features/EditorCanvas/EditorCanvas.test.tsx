/**
 * @vitest-environment happy-dom
 */
import { type IEditor } from '@lobehub/editor';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EditorCanvas } from './EditorCanvas';

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

// Mock ErrorBoundary to pass through children
vi.mock('./ErrorBoundary', () => ({
  EditorErrorBoundary: vi.fn(({ children }) => <>{children}</>),
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
      });
    });

    it('should forward props to EditorDataMode', async () => {
      const onContentChange = vi.fn();
      const onInit = vi.fn();
      const editorData = { content: 'test', editorData: { blocks: [] } };

      render(
        <EditorCanvas
          editor={mockEditor}
          editorData={editorData}
          placeholder="Custom placeholder"
          onContentChange={onContentChange}
          onInit={onInit}
        />,
      );

      const EditorDataMode = await vi.importMock('./EditorDataMode');
      const lastCall = (EditorDataMode.default as ReturnType<typeof vi.fn>).mock.calls.at(-1);

      expect(lastCall?.[0]).toMatchObject({
        editor: mockEditor,
        editorData,
        onContentChange,
        onInit,
        placeholder: 'Custom placeholder',
      });
    });

    it('should forward props to InternalEditor in basic mode', async () => {
      const onContentChange = vi.fn();
      const onInit = vi.fn();

      render(
        <EditorCanvas
          editor={mockEditor}
          floatingToolbar={false}
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
        onContentChange,
        onInit,
        placeholder: 'Custom placeholder',
      });
    });
  });

  describe('error boundary wrapping', () => {
    it('should wrap DocumentIdMode with ErrorBoundary', async () => {
      render(<EditorCanvas documentId="doc-123" editor={mockEditor} />);

      const ErrorBoundary = await vi.importMock('./ErrorBoundary');
      expect(ErrorBoundary.EditorErrorBoundary).toHaveBeenCalled();
    });

    it('should wrap EditorDataMode with ErrorBoundary', async () => {
      render(<EditorCanvas editor={mockEditor} editorData={{ content: 'test' }} />);

      const ErrorBoundary = await vi.importMock('./ErrorBoundary');
      expect(ErrorBoundary.EditorErrorBoundary).toHaveBeenCalled();
    });

    it('should wrap InternalEditor with ErrorBoundary in basic mode', async () => {
      render(<EditorCanvas editor={mockEditor} />);

      const ErrorBoundary = await vi.importMock('./ErrorBoundary');
      expect(ErrorBoundary.EditorErrorBoundary).toHaveBeenCalled();
    });
  });
});
