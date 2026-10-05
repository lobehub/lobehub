/**
 * @vitest-environment happy-dom
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useComposerDraftBus } from '@/features/Conversation/composerDraftBus';

import { ImageStageContext, type ImageStageValue } from '../context';
import { clientToImagePoint, type Point } from '../geometry';
import ImageEditTools from './index';
import { EMPTY_MARKUP, type ImageMarkup } from './markup';

const fileStore = vi.hoisted(() => ({
  chatUploadFileList: [] as { error?: string; file: File; id: string; status: string }[],
  dispatchChatUploadFileList: vi.fn(),
  refreshFileList: vi.fn(),
  uploadChatFiles: vi.fn(),
  uploadWithProgress: vi.fn(),
}));
vi.mock('@/store/file', () => ({
  fileManagerSelectors: {
    getFileByChunkTargetId: () => () => ({ id: 'file_src', parentId: 'docs_folder' }),
  },
  useFileStore: { getState: () => fileStore },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: { getState: () => ({ activeAgentId: 'agt_current' }) },
}));
vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (s: unknown) => unknown) => selector({}),
}));
vi.mock('@/store/agent/selectors', () => ({
  builtinAgentSelectors: { inboxAgentId: () => 'agt_inbox' },
}));

const navigate = vi.hoisted(() => vi.fn());
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigate,
}));

const exporter = vi.hoisted(() => ({
  loadStageImage: vi.fn(),
  renderImageToBlob: vi.fn(),
}));
vi.mock('./exportImage', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  renderImageToBlob: exporter.renderImageToBlob,
}));

const location = vi.hoisted(() => ({
  addToKnowledgeBase: vi.fn(),
  getFile: vi.fn(),
}));
vi.mock('./AIEdit/deps', async (importOriginal) => {
  const { aiEditDeps } = await importOriginal<{ aiEditDeps: object }>();
  return { aiEditDeps: { ...aiEditDeps, ...location }, loadStageImage: exporter.loadStageImage };
});

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast,
}));

// The displayed image box: 200×100 at the page origin.
const RECT = { bottom: 100, height: 100, left: 0, right: 200, top: 0, width: 200, x: 0, y: 0 };

const renderTools = (stage: Partial<ImageStageValue> = {}) => {
  const overlay = document.createElement('div');
  overlay.getBoundingClientRect = () => RECT as DOMRect;
  document.body.append(overlay);
  const fitToScreen = vi.fn();
  const addVersion = vi.fn();
  const value: ImageStageValue = {
    addVersion,
    fileId: 'file_src',
    fitToScreen,
    markup: EMPTY_MARKUP,
    name: 'sunset.jpg',
    naturalSize: { height: 1000, width: 2000 },
    overlayElement: overlay,
    rotation: 0,
    setMarkup: () => {},
    toImagePoint: (client) => clientToImagePoint(client, RECT, 0),
    url: 'https://s3/sunset.jpg',
    zoom: 1,
    ...stage,
  };
  // Marks live in the viewer; this stands in for it.
  const Wrapper = ({ children }: { children: ReactNode }) => {
    const [markup, setMarkup] = useState<ImageMarkup>(EMPTY_MARKUP);
    return (
      <ImageStageContext value={{ ...value, markup, setMarkup }}>{children}</ImageStageContext>
    );
  };
  return { addVersion, fitToScreen, overlay, ...render(<ImageEditTools />, { wrapper: Wrapper }) };
};

describe('ImageEditTools', () => {
  beforeEach(() => {
    useComposerDraftBus.setState({ attached: true, draft: null });
    fileStore.chatUploadFileList = [];
    fileStore.uploadChatFiles.mockImplementation(async ([file]: File[]) => {
      fileStore.chatUploadFileList = [{ file, id: 'file_chat', status: 'success' }];
    });
    exporter.loadStageImage.mockResolvedValue({ naturalHeight: 1000, naturalWidth: 2000 });
    exporter.renderImageToBlob.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    fileStore.uploadWithProgress.mockResolvedValue({ id: 'file_new', url: 'files/new.png' });
    location.addToKnowledgeBase.mockResolvedValue(undefined);
    location.getFile.mockResolvedValue({ knowledgeBaseIds: ['kb_1'], parentId: 'docs_folder' });
  });

  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('shows annotate, comment and resize in the floating toolbar', () => {
    renderTools();

    const toolbar = screen.getByRole('toolbar', { name: 'imageViewer.editTools' });
    expect(within(toolbar).getByText('imageViewer.tool.annotate')).toBeInTheDocument();
    expect(within(toolbar).getByText('imageViewer.tool.comment')).toBeInTheDocument();
    expect(within(toolbar).getByText('imageViewer.tool.resize')).toBeInTheDocument();
    // Nothing to send until something is marked.
    expect(screen.queryByTestId('image-markup-send')).not.toBeInTheDocument();
  });

  const addComment = (overlay: HTMLElement, text: string, from: Point, to: Point = from) => {
    const layer = within(overlay).getByTestId('image-comment-layer');
    layer.setPointerCapture = vi.fn();
    fireEvent.pointerDown(layer, { button: 0, clientX: from.x, clientY: from.y, pointerId: 1 });
    fireEvent.pointerMove(layer, { clientX: to.x, clientY: to.y, pointerId: 1 });
    fireEvent.pointerUp(layer, { clientX: to.x, clientY: to.y, pointerId: 1 });
    const input = within(overlay).getByRole('textbox', { name: 'imageViewer.comment.add' });
    fireEvent.change(input, { target: { value: text } });
    fireEvent.keyDown(input, { key: 'Enter' });
  };

  const drawBox = (overlay: HTMLElement) => {
    fireEvent.click(screen.getByRole('button', { name: 'imageViewer.annotate.rect' }));
    const canvas = within(overlay).getByTestId('image-annotate-canvas');
    canvas.setPointerCapture = vi.fn();
    fireEvent.pointerDown(canvas, { button: 0, clientX: 20, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 120, clientY: 60, pointerId: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
  };

  describe('comments', () => {
    it('pins a comment at a clicked point and another on a dragged region', () => {
      const { overlay } = renderTools();
      fireEvent.click(screen.getByText('imageViewer.tool.comment'));
      expect(screen.getByText('imageViewer.comment.empty')).toBeInTheDocument();

      addComment(overlay, 'Too dark here', { x: 50, y: 75 });
      addComment(overlay, 'Remove this', { x: 100, y: 20 }, { x: 160, y: 80 });

      const panel = screen.getByTestId('image-comment-panel');
      expect(within(panel).getByText('Too dark here')).toBeInTheDocument();
      expect(within(panel).getByText('Remove this')).toBeInTheDocument();
      const pins = within(overlay).getAllByRole('button', { name: 'imageViewer.comment.pin' });
      expect(pins).toHaveLength(2);
      expect(pins[0]).toHaveStyle({ left: '25%', top: '75%' });
      // A region pins its number at the top-left corner and draws the area.
      expect(pins[1]).toHaveStyle({ left: '50%', top: '20%' });
      const region = within(overlay).getByTestId('image-comment-region');
      expect(parseFloat(region.style.width)).toBeCloseTo(30);
      expect(parseFloat(region.style.height)).toBeCloseTo(60);
      expect(within(overlay).queryByTestId('image-comment-draft')).not.toBeInTheDocument();
    });

    it('cancels a draft with Escape without leaving the mode', () => {
      const { overlay } = renderTools();
      fireEvent.click(screen.getByText('imageViewer.tool.comment'));
      const layer = within(overlay).getByTestId('image-comment-layer');
      fireEvent.pointerDown(layer, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
      fireEvent.pointerUp(layer, { clientX: 10, clientY: 10, pointerId: 1 });

      const input = within(overlay).getByRole('textbox', { name: 'imageViewer.comment.add' });
      fireEvent.keyDown(input, { key: 'Escape' });

      expect(within(overlay).queryByTestId('image-comment-draft')).not.toBeInTheDocument();
      expect(screen.getByTestId('image-comment-panel')).toBeInTheDocument();
    });

    it('removes a comment from the list', () => {
      const { overlay } = renderTools();
      fireEvent.click(screen.getByText('imageViewer.tool.comment'));
      addComment(overlay, 'Nice sky', { x: 100, y: 50 });

      const panel = screen.getByTestId('image-comment-panel');
      fireEvent.click(within(panel).getByRole('button', { name: 'imageViewer.comment.delete' }));

      expect(within(panel).queryByText('Nice sky')).not.toBeInTheDocument();
      expect(within(panel).getByText('imageViewer.comment.empty')).toBeInTheDocument();
    });

    it('starts with the list collapsed in a narrow host and toggles it from the bar', async () => {
      const host = document.createElement('div');
      host.dataset.testid = 'image-viewer';
      Object.defineProperty(host, 'clientWidth', { value: 480 });
      const overlay = document.createElement('div');
      overlay.getBoundingClientRect = () => RECT as DOMRect;
      host.append(overlay);
      document.body.append(host);
      renderTools({ overlayElement: overlay });

      fireEvent.click(screen.getByText('imageViewer.tool.comment'));
      expect(screen.queryByTestId('image-comment-panel')).not.toBeInTheDocument();

      const toggle = screen.getByRole('button', { name: 'imageViewer.comment.title' });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      fireEvent.click(toggle);
      expect(await screen.findByTestId('image-comment-panel')).toBeInTheDocument();
    });

    it('keeps comments in memory only: a new viewer starts empty', () => {
      const first = renderTools();
      fireEvent.click(screen.getByText('imageViewer.tool.comment'));
      addComment(first.overlay, 'Nice sky', { x: 100, y: 50 });
      first.unmount();
      document.body.innerHTML = '';

      renderTools();
      fireEvent.click(screen.getByText('imageViewer.tool.comment'));
      expect(screen.getByText('imageViewer.comment.empty')).toBeInTheDocument();
    });
  });

  describe('add to chat', () => {
    it('puts the marked-up image and numbered comments into the open chat input', async () => {
      const { overlay } = renderTools();
      fireEvent.click(screen.getByText('imageViewer.tool.annotate'));
      expect(screen.getByTestId('image-markup-send')).toBeDisabled();
      drawBox(overlay);
      fireEvent.click(screen.getByRole('button', { name: 'imageViewer.done' }));

      fireEvent.click(screen.getByText('imageViewer.tool.comment'));
      // The drawing stays visible while commenting.
      expect(within(overlay).getByTestId('image-markup-preview')).toBeInTheDocument();
      addComment(overlay, 'Make this brighter', { x: 20, y: 20 });
      addComment(overlay, 'Remove this', { x: 100, y: 20 }, { x: 160, y: 80 });

      const send = screen.getByTestId('image-markup-send');
      expect(send).toHaveTextContent('imageViewer.markup.addToChat');
      await act(async () => {
        fireEvent.click(send);
      });

      await waitFor(() => expect(fileStore.uploadChatFiles).toHaveBeenCalled());
      // One image carries both the drawing and the numbered comment markers.
      const [, options] = exporter.renderImageToBlob.mock.calls[0];
      expect(options.shapes).toEqual([
        expect.objectContaining({
          rect: {
            height: expect.closeTo(0.5),
            width: expect.closeTo(0.5),
            x: expect.closeTo(0.1),
            y: expect.closeTo(0.1),
          },
          type: 'rect',
        }),
      ]);
      expect(options.comments.map((c: { text: string }) => c.text)).toEqual([
        'Make this brighter',
        'Remove this',
      ]);

      const [[file], agentId] = fileStore.uploadChatFiles.mock.calls[0];
      expect(file.name).toBe('sunset-annotated.png');
      expect(agentId).toBe('agt_current');
      // Nothing is saved to the library.
      expect(fileStore.uploadWithProgress).not.toHaveBeenCalled();

      const draft = useComposerDraftBus.getState().draft!;
      expect(draft.append).toBe(true);
      // Header plus one numbered line per comment (wording covered in markup.test.ts).
      expect(draft.text.split('\n')).toEqual([
        'imageViewer.markup.message.headerWithDrawing',
        'imageViewer.markup.message.item',
        'imageViewer.markup.message.item',
      ]);
      expect(navigate).not.toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith('imageViewer.markup.added');

      // Sent marks are cleared, back to the main toolbar.
      expect(
        await screen.findByRole('toolbar', { name: 'imageViewer.editTools' }),
      ).toBeInTheDocument();
      expect(within(overlay).queryByTestId('image-markup-preview')).not.toBeInTheDocument();
    });

    it('offers sending from the main toolbar once something is marked', async () => {
      const { overlay } = renderTools();
      fireEvent.click(screen.getByText('imageViewer.tool.annotate'));
      drawBox(overlay);
      fireEvent.keyDown(window, { key: 'Escape' });

      const toolbar = screen.getByRole('toolbar', { name: 'imageViewer.editTools' });
      expect(within(toolbar).getByTestId('image-markup-send')).toBeEnabled();

      fireEvent.click(within(toolbar).getByRole('button', { name: 'imageViewer.markup.discard' }));
      expect(screen.queryByTestId('image-markup-send')).not.toBeInTheDocument();
    });

    it('starts a chat with the inbox agent when no conversation is open', async () => {
      useComposerDraftBus.setState({ attached: false, draft: null });
      const { overlay } = renderTools();
      fireEvent.click(screen.getByText('imageViewer.tool.comment'));
      addComment(overlay, 'What is this?', { x: 100, y: 50 });

      const send = screen.getByTestId('image-markup-send');
      expect(send).toHaveTextContent('imageViewer.markup.askInNewChat');
      await act(async () => {
        fireEvent.click(send);
      });

      await waitFor(() => expect(navigate).toHaveBeenCalledWith('/agent/agt_inbox'));
      expect(fileStore.uploadChatFiles.mock.calls[0][1]).toBe('agt_inbox');
      // Queued for the composer that mounts after navigating.
      expect(useComposerDraftBus.getState().draft?.text).toContain(
        'imageViewer.markup.message.item',
      );
    });

    it('undoes strokes and exits with Escape', () => {
      const { overlay } = renderTools();
      fireEvent.click(screen.getByText('imageViewer.tool.annotate'));
      drawBox(overlay);

      expect(screen.getByTestId('image-markup-send')).toBeEnabled();
      fireEvent.keyDown(window, { ctrlKey: true, key: 'z' });
      expect(screen.getByTestId('image-markup-send')).toBeDisabled();

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.getByRole('toolbar', { name: 'imageViewer.editTools' })).toBeInTheDocument();
      expect(within(overlay).queryByTestId('image-annotate-canvas')).not.toBeInTheDocument();
    });

    // Regression: the text and success used to land before the attachment was
    // in the input, so Send could go out with the text alone.
    it('keeps the marks and adds no text when the attachment does not reach the input', async () => {
      fileStore.uploadChatFiles.mockImplementation(async ([file]: File[]) => {
        fileStore.chatUploadFileList = [
          { error: 'Upload failed', file, id: 'sunset-annotated.png', status: 'error' },
        ];
      });
      const { overlay } = renderTools();
      fireEvent.click(screen.getByText('imageViewer.tool.annotate'));
      drawBox(overlay);

      await act(async () => {
        fireEvent.click(screen.getByTestId('image-markup-send'));
      });

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('imageViewer.markup.failed'));
      expect(fileStore.dispatchChatUploadFileList).toHaveBeenCalledWith({
        id: 'sunset-annotated.png',
        type: 'removeFile',
      });
      expect(useComposerDraftBus.getState().draft).toBeNull();
      expect(toast.success).not.toHaveBeenCalled();
      expect(screen.getByTestId('image-markup-send')).toBeEnabled();
    });

    it('judges this upload, not an earlier attachment with the same name', async () => {
      const earlier = new File(['old'], 'sunset-annotated.png', { type: 'image/png' });
      fileStore.chatUploadFileList = [{ file: earlier, id: 'file_earlier', status: 'success' }];
      fileStore.uploadChatFiles.mockImplementation(async ([file]: File[]) => {
        fileStore.chatUploadFileList = [
          ...fileStore.chatUploadFileList,
          { error: 'Upload failed', file, id: 'sunset-annotated.png', status: 'error' },
        ];
      });
      const { overlay } = renderTools();
      fireEvent.click(screen.getByText('imageViewer.tool.annotate'));
      drawBox(overlay);

      await act(async () => {
        fireEvent.click(screen.getByTestId('image-markup-send'));
      });

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('imageViewer.markup.failed'));
      expect(useComposerDraftBus.getState().draft).toBeNull();
    });

    it('reports when the storage does not allow reading pixels', async () => {
      const { ImagePixelsUnavailableError } = await import('./exportImage');
      exporter.loadStageImage.mockRejectedValue(new ImagePixelsUnavailableError());
      const { overlay } = renderTools();
      fireEvent.click(screen.getByText('imageViewer.tool.annotate'));
      drawBox(overlay);

      await act(async () => {
        fireEvent.click(screen.getByTestId('image-markup-send'));
      });

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith('imageViewer.pixelsUnavailable'),
      );
      expect(fileStore.uploadChatFiles).not.toHaveBeenCalled();
      // Stay in the mode so the drawing is not lost.
      expect(within(overlay).getByTestId('image-annotate-canvas')).toBeInTheDocument();
    });
  });

  describe('resize', () => {
    it('crops to a preset ratio, scales and saves a new file', async () => {
      const { overlay } = renderTools();
      fireEvent.click(screen.getByText('imageViewer.tool.resize'));

      const width = screen.getByLabelText('imageViewer.resize.width');
      const height = screen.getByLabelText('imageViewer.resize.height');
      expect(width).toHaveValue(2000);
      expect(height).toHaveValue(1000);

      // Ratio is locked by default: editing the width drives the height.
      fireEvent.change(width, { target: { value: '1000' } });
      await waitFor(() => expect(height).toHaveValue(500));

      const box = within(overlay).getByTestId('image-crop-box');
      expect(box).toHaveStyle({ height: '100%', left: '0%', top: '0%', width: '100%' });

      // Drag the bottom-right handle inwards by a quarter of the box.
      const handle = box.querySelector('[data-handle="se"]') as HTMLElement;
      handle.setPointerCapture = vi.fn();
      fireEvent.pointerDown(handle, { button: 0, clientX: 200, clientY: 100, pointerId: 1 });
      fireEvent.pointerMove(handle, { clientX: 150, clientY: 75, pointerId: 1 });
      fireEvent.pointerUp(handle, { pointerId: 1 });
      expect(box).toHaveStyle({ height: '75%', width: '75%' });
      // A new crop resets the output to the crop's pixel size.
      expect(width).toHaveValue(1500);
      expect(height).toHaveValue(750);

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'imageViewer.saveAsNew' }));
      });

      await waitFor(() => expect(fileStore.uploadWithProgress).toHaveBeenCalled());
      expect(exporter.renderImageToBlob.mock.calls[0][1]).toEqual({
        crop: { height: 0.75, width: 0.75, x: 0, y: 0 },
        output: { height: 750, width: 1500 },
      });
      const upload = fileStore.uploadWithProgress.mock.calls[0][0];
      expect(upload.file.name).toBe('sunset-resized.png');
      expect(upload.fileMetadata.derivedFrom.operation).toBe('resize');
    });

    it('lets a size field be emptied while typing', () => {
      renderTools();
      fireEvent.click(screen.getByText('imageViewer.tool.resize'));
      const width = screen.getByLabelText('imageViewer.resize.width');

      fireEvent.change(width, { target: { value: '' } });
      expect(width).toHaveValue(null);
      fireEvent.change(width, { target: { value: '800' } });
      expect(screen.getByLabelText('imageViewer.resize.height')).toHaveValue(400);

      fireEvent.blur(width);
      expect(width).toHaveValue(800);
    });

    it('cancels with Escape even while a size field has focus', () => {
      renderTools();
      fireEvent.click(screen.getByText('imageViewer.tool.resize'));
      const width = screen.getByLabelText('imageViewer.resize.width');
      width.focus();
      fireEvent.keyDown(width, { key: 'Escape' });

      expect(screen.getByRole('toolbar', { name: 'imageViewer.editTools' })).toBeInTheDocument();
      expect(fileStore.uploadWithProgress).not.toHaveBeenCalled();
    });

    it('cancels back to the toolbar without saving', () => {
      renderTools();
      fireEvent.click(screen.getByText('imageViewer.tool.resize'));
      fireEvent.click(screen.getByRole('button', { name: 'imageViewer.cancel' }));

      expect(screen.getByRole('toolbar', { name: 'imageViewer.editTools' })).toBeInTheDocument();
      expect(fileStore.uploadWithProgress).not.toHaveBeenCalled();
    });
  });
});
