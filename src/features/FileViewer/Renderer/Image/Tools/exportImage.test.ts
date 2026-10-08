/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ImagePixelsUnavailableError, loadReadableImage, renderImageToBlob } from './exportImage';

const createCtx = () => ({
  arc: vi.fn(),
  beginPath: vi.fn(),
  fill: vi.fn(),
  fillText: vi.fn(),
  drawImage: vi.fn(),
  imageSmoothingQuality: 'low',
  lineTo: vi.fn(),
  moveTo: vi.fn(),
  restore: vi.fn(),
  save: vi.fn(),
  setLineDash: vi.fn(),
  setTransform: vi.fn(),
  stroke: vi.fn(),
  strokeRect: vi.fn(),
});

const source = { naturalHeight: 1000, naturalWidth: 2000 } as unknown as HTMLImageElement;

describe('renderImageToBlob', () => {
  let ctx: ReturnType<typeof createCtx>;
  let canvases: HTMLCanvasElement[];
  let tainted: boolean;

  beforeEach(() => {
    ctx = createCtx();
    canvases = [];
    tainted = false;
    const create = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const element = create(tag);
      if (tag === 'canvas') {
        const canvas = element as HTMLCanvasElement;
        canvas.getContext = vi.fn(() => ctx) as never;
        canvas.toBlob = vi.fn((callback: BlobCallback, type?: string) => {
          if (tainted)
            throw new DOMException('Tainted canvases may not be exported.', 'SecurityError');
          callback(new Blob(['png'], { type }));
        }) as never;
        canvases.push(canvas);
      }
      return element;
    }) as typeof document.createElement);
  });

  afterEach(() => vi.restoreAllMocks());

  it('exports the full image at natural size by default', async () => {
    const blob = await renderImageToBlob(source);

    expect(blob.type).toBe('image/png');
    expect(canvases[0].width).toBe(2000);
    expect(canvases[0].height).toBe(1000);
    expect(ctx.drawImage).toHaveBeenCalledWith(source, 0, 0, 2000, 1000, 0, 0, 2000, 1000);
    expect(ctx.strokeRect).not.toHaveBeenCalled();
  });

  // Regression: annotate/erase exports allocated a full-resolution canvas,
  // which a very large image can push past the browser's limits.
  it('caps an export without an explicit size at the default max edge', async () => {
    const huge = { naturalHeight: 6000, naturalWidth: 12_000 } as unknown as HTMLImageElement;
    await renderImageToBlob(huge);

    expect(canvases[0].width).toBe(4096);
    expect(canvases[0].height).toBe(2048);
  });

  it('crops and scales to the requested output size', async () => {
    await renderImageToBlob(source, {
      crop: { height: 0.5, width: 0.25, x: 0.5, y: 0.25 },
      output: { height: 250, width: 250 },
    });

    expect(canvases[0].width).toBe(250);
    expect(ctx.drawImage).toHaveBeenCalledWith(source, 1000, 250, 500, 500, 0, 0, 250, 250);
  });

  it('burns annotations into the exported pixels', async () => {
    await renderImageToBlob(source, {
      shapes: [
        {
          color: '#f00',
          rect: { height: 0.1, width: 0.1, x: 0.1, y: 0.1 },
          size: 0.01,
          type: 'rect',
        },
      ],
    });

    expect(ctx.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, -0, -0);
    expect(ctx.strokeRect).toHaveBeenCalledWith(200, 100, 200, 100);
  });

  it('burns numbered comment markers into the exported pixels', async () => {
    await renderImageToBlob(source, {
      comments: [
        { anchor: { point: { x: 0.5, y: 0.5 }, type: 'point' }, id: 'a', text: 'here' },
        {
          anchor: { rect: { height: 0.2, width: 0.1, x: 0.1, y: 0.1 }, type: 'region' },
          id: 'b',
          text: 'there',
        },
      ],
    });

    expect(ctx.fillText).toHaveBeenNthCalledWith(1, '1', 1000, 500);
    expect(ctx.fillText).toHaveBeenNthCalledWith(2, '2', 200, 100);
    // A region also gets its outline.
    expect(ctx.strokeRect).toHaveBeenCalledWith(200, 100, 200, 200);
  });

  it('reports unreadable pixels when the canvas is tainted', async () => {
    tainted = true;

    await expect(renderImageToBlob(source)).rejects.toBeInstanceOf(ImagePixelsUnavailableError);
  });
});

describe('loadReadableImage', () => {
  class FakeImage extends EventTarget {
    decoding = '';
    naturalHeight = 800;
    naturalWidth = 1200;
    set src(value: string) {
      this.loaded = value;
      queueMicrotask(() => this.dispatchEvent(new Event('load')));
    }
    loaded = '';
  }

  beforeEach(() => {
    vi.stubGlobal('Image', FakeImage);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local/1');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Regression: the viewer shows the image without CORS first, so the HTTP
  // cache holds a response without Access-Control-Allow-Origin. Reading the
  // pixels must bypass that cached entry or every export fails.
  it('reads storage bytes past the HTTP cache and decodes them from a blob URL', async () => {
    const fetchMock = vi.fn(async () => new Response(new Blob(['png'], { type: 'image/png' })));
    vi.stubGlobal('fetch', fetchMock);

    const img = (await loadReadableImage('https://s3/a.png?sig=1')) as unknown as FakeImage;

    expect(fetchMock).toHaveBeenCalledWith('https://s3/a.png?sig=1', {
      cache: 'no-store',
      credentials: 'omit',
      mode: 'cors',
    });
    expect(img.loaded).toBe('blob:local/1');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local/1');
  });

  // Regression: production files are `/f/:id` proxy URLs that redirect to
  // storage; a cross-origin redirect nulls the Origin so CORS always fails.
  it('reads a /f/:id proxy file from the storage URL behind it', async () => {
    const fetchMock = vi.fn(async () => new Response(new Blob(['png'], { type: 'image/png' })));
    vi.stubGlobal('fetch', fetchMock);
    const resolveProxyUrl = vi.fn(async () => 'https://s3/files/a.png?sig=2');

    await loadReadableImage('https://app.lobehub.com/f/file_abc', { resolveProxyUrl });

    expect(resolveProxyUrl).toHaveBeenCalledWith('file_abc');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://s3/files/a.png?sig=2',
      expect.objectContaining({ mode: 'cors' }),
    );
  });

  it('fetches other URLs as they are', async () => {
    const fetchMock = vi.fn(async () => new Response(new Blob(['png'], { type: 'image/png' })));
    vi.stubGlobal('fetch', fetchMock);
    const resolveProxyUrl = vi.fn();

    await loadReadableImage('https://s3/f/file_abc/a.png', { resolveProxyUrl });

    expect(resolveProxyUrl).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith('https://s3/f/file_abc/a.png', expect.anything());
  });

  it('reports pixels as unavailable when the storage URL cannot be resolved', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const resolveProxyUrl = vi.fn(async () => {
      throw new Error('NOT_FOUND');
    });

    await expect(loadReadableImage('/f/file_abc', { resolveProxyUrl })).rejects.toBeInstanceOf(
      ImagePixelsUnavailableError,
    );
  });

  it('reports unreadable pixels when storage refuses the CORS request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    await expect(loadReadableImage('https://s3/a.png')).rejects.toBeInstanceOf(
      ImagePixelsUnavailableError,
    );
  });

  it('loads blob URLs directly', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await loadReadableImage('blob:local/upload');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
