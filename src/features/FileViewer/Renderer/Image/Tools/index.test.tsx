/**
 * @vitest-environment happy-dom
 */
import type { FileCommentItem } from '@lobechat/types';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ImageStageContext, type ImageStageValue } from '../context';
import { clientToImagePoint } from '../geometry';
import ImageEditTools from './index';

const service = vi.hoisted(() => ({
  create: vi.fn(),
  delete: vi.fn(),
  list: vi.fn(),
}));
vi.mock('@/services/fileComment', () => ({ fileCommentService: service }));

const fileStore = vi.hoisted(() => ({
  refreshFileList: vi.fn(),
  uploadWithProgress: vi.fn(),
}));
vi.mock('@/store/file', () => ({
  fileManagerSelectors: {
    getFileByChunkTargetId: () => () => ({ id: 'file_src', parentId: 'docs_folder' }),
  },
  useFileStore: { getState: () => fileStore },
}));

const location = vi.hoisted(() => ({
  addToKnowledgeBase: vi.fn(),
  getFile: vi.fn(),
}));
vi.mock('./AIEdit/deps', async (importOriginal) => {
  const { aiEditDeps } = await importOriginal<{ aiEditDeps: object }>();
  return { aiEditDeps: { ...aiEditDeps, ...location } };
});

const exporter = vi.hoisted(() => ({
  loadReadableImage: vi.fn(),
  renderImageToBlob: vi.fn(),
}));
vi.mock('./exportImage', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadReadableImage: exporter.loadReadableImage,
  renderImageToBlob: exporter.renderImageToBlob,
}));

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast,
}));

const comment = (overrides: Partial<FileCommentItem>): FileCommentItem => ({
  anchor: { x: 0.5, y: 0.5 },
  content: 'Nice sky',
  createdAt: new Date('2026-10-05T00:00:00Z'),
  fileId: 'file_src',
  id: 'fcm_1',
  updatedAt: new Date('2026-10-05T00:00:00Z'),
  userId: 'u1',
  ...overrides,
});

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
    name: 'sunset.jpg',
    naturalSize: { height: 1000, width: 2000 },
    overlayElement: overlay,
    rotation: 0,
    toImagePoint: (client) => clientToImagePoint(client, RECT, 0),
    url: 'https://s3/sunset.jpg',
    zoom: 1,
    ...stage,
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>
      <ImageStageContext value={value}>{children}</ImageStageContext>
    </SWRConfig>
  );
  return { addVersion, fitToScreen, overlay, ...render(<ImageEditTools />, { wrapper }) };
};

describe('ImageEditTools', () => {
  beforeEach(() => {
    service.list.mockResolvedValue({ data: [], success: true });
    exporter.loadReadableImage.mockResolvedValue({ naturalHeight: 1000, naturalWidth: 2000 });
    exporter.renderImageToBlob.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    fileStore.uploadWithProgress.mockResolvedValue({ id: 'file_new', url: 'files/new.png' });
    location.addToKnowledgeBase.mockResolvedValue(undefined);
    location.getFile.mockResolvedValue({ knowledgeBaseIds: ['kb_1'], parentId: 'docs_folder' });
  });

  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('shows annotate, comment and resize in the floating toolbar', async () => {
    service.list.mockResolvedValue({ data: [comment({})], success: true });
    renderTools();

    const toolbar = screen.getByRole('toolbar', { name: 'imageViewer.editTools' });
    expect(within(toolbar).getByText('imageViewer.tool.annotate')).toBeInTheDocument();
    expect(within(toolbar).getByText('imageViewer.tool.comment')).toBeInTheDocument();
    expect(within(toolbar).getByText('imageViewer.tool.resize')).toBeInTheDocument();
    // The existing comment count is visible before entering the mode.
    expect(await within(toolbar).findByText('1')).toBeInTheDocument();
  });

  describe('comments', () => {
    it('lists persisted comments as pins and in the side panel', async () => {
      service.list.mockResolvedValue({
        data: [comment({}), comment({ anchor: { x: 0.1, y: 0.2 }, content: 'Crop', id: 'fcm_2' })],
        success: true,
      });
      const { overlay } = renderTools();

      fireEvent.click(screen.getByText('imageViewer.tool.comment'));

      const panel = await screen.findByTestId('image-comment-panel');
      expect(await within(panel).findByText('Nice sky')).toBeInTheDocument();
      expect(within(panel).getByText('Crop')).toBeInTheDocument();

      const pins = within(overlay).getAllByRole('button', { name: 'imageViewer.comment.pin' });
      expect(pins[1]).toHaveStyle({ left: '10%', top: '20%' });
    });

    it('pins a new comment at the clicked point', async () => {
      service.create.mockImplementation(async (input) => ({
        data: comment({ ...input, id: 'fcm_new' }),
        success: true,
      }));
      const { overlay } = renderTools();
      fireEvent.click(screen.getByText('imageViewer.tool.comment'));
      await screen.findByText('imageViewer.comment.empty');

      const layer = within(overlay).getByTestId('image-comment-layer');
      fireEvent.click(layer, { clientX: 50, clientY: 75 });

      const input = within(overlay).getByRole('textbox', { name: 'imageViewer.comment.add' });
      fireEvent.change(input, { target: { value: 'Too dark here' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() =>
        expect(service.create).toHaveBeenCalledWith({
          anchor: { x: 0.25, y: 0.75 },
          content: 'Too dark here',
          fileId: 'file_src',
        }),
      );
      expect(await screen.findByText('Too dark here')).toBeInTheDocument();
      expect(within(overlay).queryByTestId('image-comment-draft')).not.toBeInTheDocument();
    });

    it('cancels a draft with Escape without leaving the mode', async () => {
      const { overlay } = renderTools();
      fireEvent.click(screen.getByText('imageViewer.tool.comment'));
      fireEvent.click(within(overlay).getByTestId('image-comment-layer'), {
        clientX: 10,
        clientY: 10,
      });

      const input = within(overlay).getByRole('textbox', { name: 'imageViewer.comment.add' });
      fireEvent.keyDown(input, { key: 'Escape' });

      expect(within(overlay).queryByTestId('image-comment-draft')).not.toBeInTheDocument();
      expect(screen.getByTestId('image-comment-panel')).toBeInTheDocument();
      expect(service.create).not.toHaveBeenCalled();
    });

    it('deletes a comment', async () => {
      service.list.mockResolvedValueOnce({ data: [comment({})], success: true });
      service.list.mockResolvedValue({ data: [], success: true });
      service.delete.mockResolvedValue({ success: true });
      renderTools();
      fireEvent.click(screen.getByText('imageViewer.tool.comment'));

      const panel = await screen.findByTestId('image-comment-panel');
      await within(panel).findByText('Nice sky');
      fireEvent.click(within(panel).getByRole('button', { name: 'imageViewer.comment.delete' }));

      await waitFor(() => expect(service.delete).toHaveBeenCalledWith('fcm_1'));
      await waitFor(() => expect(within(panel).queryByText('Nice sky')).not.toBeInTheDocument());
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

    it('shows a load error with retry', async () => {
      service.list.mockRejectedValue(Object.assign(new Error('boom'), { status: 400 }));
      renderTools();
      fireEvent.click(screen.getByText('imageViewer.tool.comment'));

      expect(await screen.findByText('imageViewer.comment.loadFailed')).toBeInTheDocument();
    });
  });

  describe('annotate', () => {
    it('draws a box and saves the annotated image as a new file', async () => {
      const { addVersion, fitToScreen, overlay } = renderTools();
      fireEvent.click(screen.getByText('imageViewer.tool.annotate'));
      expect(fitToScreen).toHaveBeenCalled();

      const save = screen.getByRole('button', { name: 'imageViewer.saveAsNew' });
      expect(save).toBeDisabled();

      fireEvent.click(screen.getByRole('button', { name: 'imageViewer.annotate.rect' }));
      const canvas = within(overlay).getByTestId('image-annotate-canvas');
      canvas.setPointerCapture = vi.fn();
      fireEvent.pointerDown(canvas, { button: 0, clientX: 20, clientY: 10, pointerId: 1 });
      fireEvent.pointerMove(canvas, { clientX: 120, clientY: 60, pointerId: 1 });
      fireEvent.pointerUp(canvas, { pointerId: 1 });

      expect(save).toBeEnabled();
      await act(async () => {
        fireEvent.click(save);
      });

      await waitFor(() => expect(fileStore.uploadWithProgress).toHaveBeenCalled());
      const [img, options] = exporter.renderImageToBlob.mock.calls[0];
      expect(img).toMatchObject({ naturalWidth: 2000 });
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

      const upload = fileStore.uploadWithProgress.mock.calls[0][0];
      expect(upload.file.name).toBe('sunset-annotated.png');
      expect(upload.fileMetadata).toEqual({
        derivedFrom: { fileId: 'file_src', operation: 'annotate' },
      });
      expect(upload.parentId).toBe('docs_folder');
      // Saved into the original's library too, so a library view lists it.
      expect(location.getFile).toHaveBeenCalledWith('file_src');
      expect(location.addToKnowledgeBase).toHaveBeenCalledWith('kb_1', ['file_new']);
      expect(toast.success).toHaveBeenCalled();
      // The saved image goes on stage as a version next to the original.
      expect(addVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: 'file_new',
          name: 'sunset-annotated.png',
          operation: 'annotate',
        }),
      );
      // Back to the main toolbar after saving.
      expect(
        await screen.findByRole('toolbar', { name: 'imageViewer.editTools' }),
      ).toBeInTheDocument();
    });

    it('undoes strokes and exits with Escape', () => {
      const { overlay } = renderTools();
      fireEvent.click(screen.getByText('imageViewer.tool.annotate'));
      const canvas = within(overlay).getByTestId('image-annotate-canvas');
      canvas.setPointerCapture = vi.fn();
      fireEvent.pointerDown(canvas, { button: 0, clientX: 20, clientY: 10, pointerId: 1 });
      fireEvent.pointerMove(canvas, { clientX: 60, clientY: 40, pointerId: 1 });
      fireEvent.pointerUp(canvas, { pointerId: 1 });

      expect(screen.getByRole('button', { name: 'imageViewer.saveAsNew' })).toBeEnabled();
      fireEvent.keyDown(window, { ctrlKey: true, key: 'z' });
      expect(screen.getByRole('button', { name: 'imageViewer.saveAsNew' })).toBeDisabled();

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.getByRole('toolbar', { name: 'imageViewer.editTools' })).toBeInTheDocument();
      expect(within(overlay).queryByTestId('image-annotate-canvas')).not.toBeInTheDocument();
    });

    it('reports when the storage does not allow reading pixels', async () => {
      const { ImagePixelsUnavailableError } = await import('./exportImage');
      exporter.loadReadableImage.mockRejectedValue(new ImagePixelsUnavailableError());
      const { overlay } = renderTools();
      fireEvent.click(screen.getByText('imageViewer.tool.annotate'));
      const canvas = within(overlay).getByTestId('image-annotate-canvas');
      canvas.setPointerCapture = vi.fn();
      fireEvent.pointerDown(canvas, { button: 0, clientX: 20, clientY: 10, pointerId: 1 });
      fireEvent.pointerMove(canvas, { clientX: 60, clientY: 40, pointerId: 1 });
      fireEvent.pointerUp(canvas, { pointerId: 1 });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'imageViewer.saveAsNew' }));
      });

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith('imageViewer.pixelsUnavailable'),
      );
      expect(fileStore.uploadWithProgress).not.toHaveBeenCalled();
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
