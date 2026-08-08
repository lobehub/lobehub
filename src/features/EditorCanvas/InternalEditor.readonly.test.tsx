/**
 * @vitest-environment happy-dom
 */
import { type IEditor, ReactToolbarPlugin } from '@lobehub/editor';
import { act, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createEditorFileUploadTracker } from './editorFileUploadTracker';
import InternalEditor from './InternalEditor';
import { LinearFileCard } from './LinearFilePlugin';

const editorProps = vi.hoisted(() => ({
  last: undefined as any,
}));

vi.mock('@lobehub/editor/react', () => ({
  Editor: Object.assign(
    vi.fn((props: any) => {
      editorProps.last = props;
      return <div data-testid="editor" />;
    }),
    { withProps: (plugin: unknown) => plugin },
  ),
  useEditorState: () => ({}),
}));

vi.mock('@lobehub/editor', () => ({
  ReactImagePlugin: vi.fn(),
  ReactLinkPlugin: vi.fn(),
  ReactLiteXmlPlugin: vi.fn(),
  ReactTablePlugin: vi.fn(),
  ReactToolbarPlugin: vi.fn(),
}));

vi.mock('@/features/ChatInput/InputEditor/plugins', () => ({
  createChatInputRichPlugins: () => [],
}));

vi.mock('./InlineToolbar', () => ({
  default: () => <div />,
}));

vi.mock('@/components/FileIcon', () => ({
  default: ({ fileName }: { fileName: string }) => <div>{fileName}</div>,
}));

vi.mock('./useImageUpload', () => ({
  useFileUpload: () => vi.fn(),
  useImageUpload: () => vi.fn(),
}));

vi.mock('@lobechat/const', () => ({
  isDesktop: false,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { progress?: number }) =>
      key === 'file.uploadingProgress' ? `Uploading… ${options?.progress}%` : key,
  }),
}));

describe('InternalEditor readonly state', () => {
  const editor = {
    getDocument: vi.fn(),
    getLexicalEditor: vi.fn(() => undefined),
    setDocument: vi.fn(),
  } as unknown as IEditor;

  beforeEach(() => {
    editorProps.last = undefined;
  });

  it('passes editable=false to the editor when disabled', () => {
    render(<InternalEditor disabled editor={editor} />);

    expect(editorProps.last?.editable).toBe(false);
  });

  it('constrains the editor wrapper to its parent width', () => {
    const { container } = render(<InternalEditor editor={editor} />);

    expect(container.firstElementChild).toHaveStyle({
      maxWidth: '100%',
      overflow: 'hidden',
      width: '100%',
    });
  });

  it('registers the floating toolbar when editable', () => {
    render(<InternalEditor editor={editor} />);

    expect(editorProps.last?.plugins).toContain(ReactToolbarPlugin);
  });

  it('does not register the floating toolbar when not editable (locked page)', () => {
    render(<InternalEditor editable={false} editor={editor} />);

    expect(editorProps.last?.plugins).not.toContain(ReactToolbarPlugin);
  });

  it('does not register the floating toolbar when disabled', () => {
    render(<InternalEditor disabled editor={editor} />);

    expect(editorProps.last?.plugins).not.toContain(ReactToolbarPlugin);
  });

  it('renders the current file upload percentage', () => {
    const tracker = createEditorFileUploadTracker();
    const file = new File(['video'], 'recording.mp4', { type: 'video/mp4' });
    const uploadId = tracker.start(file);
    tracker.update(uploadId, 'uploading', { progress: 42, restTime: 8, speed: 1024 });

    render(
      <LinearFileCard
        node={{ getKey: () => 'node-1', name: file.name, status: 'pending' }}
        uploadTracker={tracker}
      />,
    );

    expect(screen.getByText('Uploading… 42%', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
  });

  it('keeps the final upload status in the processing state', () => {
    const tracker = createEditorFileUploadTracker();
    const file = new File(['video'], 'recording.mp4', { type: 'video/mp4' });
    const uploadId = tracker.start(file);
    tracker.update(uploadId, 'success', { progress: 100, restTime: 0, speed: 1024 });

    render(
      <LinearFileCard
        node={{ getKey: () => 'node-1', name: file.name, status: 'pending' }}
        uploadTracker={tracker}
      />,
    );

    expect(screen.getByText('file.processing', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText('file.preparing', { exact: false })).not.toBeInTheDocument();
  });

  it('keeps tracking progress through Strict Mode effect replay', () => {
    const tracker = createEditorFileUploadTracker();
    const file = new File(['video'], 'recording.mp4', { type: 'video/mp4' });
    const uploadId = tracker.start(file);

    render(
      <StrictMode>
        <LinearFileCard
          node={{ getKey: () => 'node-1', name: file.name, status: 'pending' }}
          uploadTracker={tracker}
        />
      </StrictMode>,
    );

    act(() => {
      tracker.update(uploadId, 'uploading', { progress: 42, restTime: 8, speed: 1024 });
    });

    expect(screen.getByText('Uploading… 42%', { exact: false })).toBeInTheDocument();
  });

  it('releases upload state when a pending file node unmounts', () => {
    const tracker = createEditorFileUploadTracker();
    const file = new File(['video'], 'recording.mp4', { type: 'video/mp4' });
    const uploadId = tracker.start(file);

    const { unmount } = render(
      <LinearFileCard
        node={{ getKey: () => 'node-1', name: file.name, status: 'pending' }}
        uploadTracker={tracker}
      />,
    );

    expect(tracker.getSnapshot('node-1')).toBeDefined();

    unmount();

    expect(tracker.getSnapshot('node-1')).toBeUndefined();

    tracker.finish(uploadId);
    const nextFile = new File(['next'], file.name, { type: file.type });
    const nextUploadId = tracker.start(nextFile);
    tracker.bindNode('node-2', nextFile.name);

    expect(tracker.getSnapshot('node-2')?.id).toBe(nextUploadId);
  });

  it('renders a persisted file card without an upload tracker', () => {
    render(
      <LinearFileCard
        node={{
          fileUrl: 'https://example.com/report.pdf',
          name: 'report.pdf',
          status: 'uploaded',
        }}
      />,
    );

    expect(screen.getAllByText('report.pdf')).not.toHaveLength(0);
  });
});
