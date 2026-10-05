/**
 * @vitest-environment happy-dom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ImageStageContext, type ImageStageValue } from '../../context';
import { clientToImagePoint } from '../../geometry';
import { createMockDeps, errorStatus, realProcessingStatus } from './fixtures';
import AIEditMode from './index';
import { ERASE_MARK_COLOR } from './request';

const aiInfra = vi.hoisted(() => ({
  enabledImageModelList: [] as any[],
}));
vi.mock('@/store/aiInfra', () => ({
  aiProviderSelectors: { enabledImageModelList: (s: any) => s.enabledImageModelList },
  getAiInfraStoreState: () => aiInfra,
}));
vi.mock('@/store/global', () => ({
  useGlobalStore: { getState: () => ({ status: {} }) },
}));

const fileStore = vi.hoisted(() => ({ refreshFileList: vi.fn() }));
vi.mock('@/store/file', () => ({
  fileManagerSelectors: {
    getFileByChunkTargetId: () => () => ({ id: 'file_src', parentId: 'docs_folder' }),
  },
  useFileStore: { getState: () => fileStore },
}));

const exporter = vi.hoisted(() => ({
  loadReadableImage: vi.fn(),
  renderImageToBlob: vi.fn(),
}));
vi.mock('../exportImage', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  renderImageToBlob: exporter.renderImageToBlob,
}));
vi.mock('./deps', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadStageImage: exporter.loadReadableImage,
}));

const toast = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn(), success: vi.fn() }));
vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast,
}));

const EDIT_MODEL = {
  children: [{ abilities: {}, id: 'gemini-3.1-flash-image:image', parameters: { imageUrls: {} } }],
  id: 'lobehub',
  name: 'LobeHub',
  source: 'builtin',
};

const RECT = { bottom: 100, height: 100, left: 0, right: 200, top: 0, width: 200, x: 0, y: 0 };

const addVersion = vi.fn();

const renderMode = (operation: 'erase' | 'removeBackground', deps = createMockDeps()) => {
  const overlay = document.createElement('div');
  overlay.getBoundingClientRect = () => RECT as DOMRect;
  document.body.append(overlay);
  const value: ImageStageValue = {
    addVersion,
    fileId: 'file_src',
    fitToScreen: vi.fn(),
    markup: { comments: [], shapes: [] },
    name: 'scene.png',
    naturalSize: { height: 512, width: 768 },
    overlayElement: overlay,
    rotation: 0,
    setMarkup: vi.fn(),
    toImagePoint: (client) => clientToImagePoint(client, RECT, 0),
    url: 'https://app.lobehub.com/f/file_src',
    zoom: 1,
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ImageStageContext value={value}>{children}</ImageStageContext>
  );
  const onExit = vi.fn();
  const view = render(<AIEditMode deps={deps} operation={operation} onExit={onExit} />, {
    wrapper,
  });
  return { ...view, onExit, overlay };
};

/** Skip past one status poll interval of the real pipeline. */
const nextPoll = () => act(() => vi.advanceTimersByTimeAsync(2100));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  aiInfra.enabledImageModelList = [EDIT_MODEL];
  exporter.loadReadableImage.mockResolvedValue({ naturalHeight: 512, naturalWidth: 768 });
  exporter.renderImageToBlob.mockResolvedValue(new Blob(['guide'], { type: 'image/png' }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

describe('AIEditMode — remove background', () => {
  it('shows progress while generating, then saves a new image and exits', async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => (finish = resolve));
    const base = createMockDeps();
    const deps = createMockDeps({
      getStatus: vi.fn(async (...args: [string, string]) => {
        await gate;
        return base.getStatus(...args);
      }),
      updateFile: vi.fn(base.updateFile),
    });
    const { onExit, overlay } = renderMode('removeBackground', deps);

    fireEvent.click(screen.getByRole('button', { name: 'imageViewer.ai.removeBackground.start' }));

    expect(await screen.findByRole('status')).toHaveTextContent('imageViewer.ai.phase.generating');
    expect(overlay.querySelector('[data-testid="image-ai-progress"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'imageViewer.cancel' })).toBeInTheDocument();

    finish();
    await nextPoll();

    await waitFor(() => expect(onExit).toHaveBeenCalled());
    expect(deps.updateFile).toHaveBeenCalledWith(
      'file_KWGzzbWzaunM',
      expect.objectContaining({ name: 'scene-no-bg.png', parentId: 'docs_folder' }),
    );
    expect(toast.success).toHaveBeenCalledWith('imageViewer.saved');
    expect(fileStore.refreshFileList).toHaveBeenCalled();
    // The result goes on stage as a version next to the original.
    expect(addVersion).toHaveBeenCalledWith({
      fileId: 'file_KWGzzbWzaunM',
      name: 'scene-no-bg.png',
      operation: 'removeBackground',
      url: 'https://app.lobehub.com/f/file_KWGzzbWzaunM',
    });
  });

  it('shows the failure inline with retry, and keeps the tool open', async () => {
    const deps = createMockDeps({ getStatus: async () => errorStatus as any });
    const { onExit } = renderMode('removeBackground', deps);

    fireEvent.click(screen.getByRole('button', { name: 'imageViewer.ai.removeBackground.start' }));
    await nextPoll();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('imageViewer.ai.error.failed');
    // The raw provider message is folded into the tooltip, not the status line.
    expect(alert).toHaveAttribute('title', 'Content blocked by the provider safety filter');
    expect(screen.getByRole('button', { name: 'imageViewer.retry' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'imageViewer.close' })).toBeInTheDocument();
    expect(onExit).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(addVersion).not.toHaveBeenCalled();
  });

  it('stops waiting for a running edit without deleting the server task', async () => {
    const deleteTopic = vi.fn(async () => undefined);
    const deps = createMockDeps({
      deleteTopic,
      getStatus: async () => realProcessingStatus as any,
    });
    const { onExit } = renderMode('removeBackground', deps);

    fireEvent.click(screen.getByRole('button', { name: 'imageViewer.ai.removeBackground.start' }));
    await screen.findByRole('status');
    fireEvent.click(screen.getByRole('button', { name: 'imageViewer.cancel' }));

    await waitFor(() => expect(toast.info).toHaveBeenCalledWith('imageViewer.ai.stoppedWaiting'));
    expect(deleteTopic).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'imageViewer.ai.removeBackground.start' }),
    ).toBeEnabled();
    expect(onExit).not.toHaveBeenCalled();
  });

  it('explains when no enabled model can edit images', async () => {
    aiInfra.enabledImageModelList = [];
    const createImage = vi.fn();
    renderMode('removeBackground', createMockDeps({ createImage }));

    fireEvent.click(screen.getByRole('button', { name: 'imageViewer.ai.removeBackground.start' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('imageViewer.ai.error.noModel');
    expect(createImage).not.toHaveBeenCalled();
  });
});

describe('AIEditMode — erase', () => {
  const paint = (canvas: HTMLElement) => {
    canvas.setPointerCapture = vi.fn();
    fireEvent.pointerDown(canvas, { button: 0, clientX: 40, clientY: 40, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 80, clientY: 60, pointerId: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
  };

  it('requires painting before erasing', () => {
    renderMode('erase');
    expect(screen.getByRole('button', { name: 'imageViewer.ai.erase.start' })).toBeDisabled();
  });

  it('renders the painted region into the guide and submits it', async () => {
    const base = createMockDeps();
    const deps = createMockDeps({
      createImage: vi.fn(base.createImage),
      uploadFile: vi.fn(base.uploadFile),
    });
    const { onExit, overlay } = renderMode('erase', deps);

    paint(overlay.querySelector('[data-testid="image-erase-canvas"]')!);
    fireEvent.click(screen.getByRole('button', { name: 'imageViewer.ai.erase.start' }));
    await waitFor(() => expect(deps.uploadFile).toHaveBeenCalled());
    await nextPoll();

    await waitFor(() => expect(onExit).toHaveBeenCalled());

    const [, options] = exporter.renderImageToBlob.mock.calls[0];
    expect(options.shapes).toHaveLength(1);
    expect(options.shapes[0]).toMatchObject({ color: ERASE_MARK_COLOR, type: 'brush' });
    expect(options.shapes[0].points[0]).toEqual({ x: 0.2, y: 0.4 });
    expect(deps.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({ file: expect.objectContaining({ name: 'scene-erase-guide.png' }) }),
    );
    expect((deps.createImage as any).mock.calls[0][0].params.imageUrls).toEqual([
      'https://app.lobehub.com/f/file_guide',
    ]);
  });

  // Regression: rendering the guide happened before the run started, so Start
  // stayed enabled and a cancel could not stop the job that followed.
  it('locks Start while the guide renders, and a cancel then submits nothing', async () => {
    let finishGuide!: (blob: Blob) => void;
    exporter.renderImageToBlob.mockReturnValue(
      new Promise<Blob>((resolve) => (finishGuide = resolve)),
    );
    const base = createMockDeps();
    const deps = createMockDeps({
      createImage: vi.fn(base.createImage),
      uploadFile: vi.fn(base.uploadFile),
    });
    const { overlay } = renderMode('erase', deps);

    paint(overlay.querySelector('[data-testid="image-erase-canvas"]')!);
    fireEvent.click(screen.getByRole('button', { name: 'imageViewer.ai.erase.start' }));

    expect(await screen.findByRole('status')).toHaveTextContent('imageViewer.ai.phase.uploading');
    expect(screen.queryByRole('button', { name: 'imageViewer.ai.erase.start' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'imageViewer.cancel' }));

    await act(async () => finishGuide(new Blob(['guide'], { type: 'image/png' })));

    await waitFor(() => expect(toast.info).toHaveBeenCalledWith('imageViewer.ai.cancelled'));
    expect(deps.uploadFile).not.toHaveBeenCalled();
    expect(deps.createImage).not.toHaveBeenCalled();
  });
});

describe('AIEditMode — task still running', () => {
  it('does not offer Retry when the status of a submitted job is unknown', async () => {
    const deps = createMockDeps({
      getStatus: async () => {
        throw new Error('fetch failed');
      },
    });
    renderMode('removeBackground', deps);

    fireEvent.click(screen.getByRole('button', { name: 'imageViewer.ai.removeBackground.start' }));
    await nextPoll();

    expect(await screen.findByRole('alert')).toHaveTextContent('imageViewer.ai.error.lostTrack');
    expect(screen.queryByRole('button', { name: 'imageViewer.retry' })).toBeNull();
    expect(screen.getByRole('button', { name: 'imageViewer.close' })).toBeInTheDocument();
  });
});
