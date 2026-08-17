import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderAvatarToDataUrl } from './notificationAvatar';

const create2dContext = () => ({
  drawImage: vi.fn(),
  fillRect: vi.fn(),
  fillStyle: '',
  fillText: vi.fn(),
  font: '',
  textAlign: '',
  textBaseline: '',
});

let context2d: ReturnType<typeof create2dContext>;
let toDataURL: ReturnType<typeof vi.fn>;

class MockImage {
  crossOrigin = '';
  private listeners = new Map<string, () => void>();

  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, listener);
  }

  set src(value: string) {
    queueMicrotask(() => {
      this.listeners.get(value.includes('broken') ? 'error' : 'load')?.();
    });
  }
}

beforeEach(() => {
  context2d = create2dContext();
  toDataURL = vi.fn(() => 'data:image/png;base64,CANVAS');
  const originalCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) =>
    tag === 'canvas'
      ? ({ getContext: () => context2d, height: 0, toDataURL, width: 0 } as any)
      : originalCreateElement(tag),
  );
  vi.stubGlobal('Image', MockImage);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('renderAvatarToDataUrl', () => {
  it('returns undefined without an avatar', async () => {
    expect(await renderAvatarToDataUrl('no-avatar', {})).toBeUndefined();
  });

  it('draws emoji avatars onto the agent background color', async () => {
    const result = await renderAvatarToDataUrl('emoji-1', {
      avatar: '🤖',
      backgroundColor: '#123456',
    });

    expect(result).toBe('data:image/png;base64,CANVAS');
    expect(context2d.fillStyle).toBe('#123456');
    expect(context2d.fillRect).toHaveBeenCalled();
    expect(context2d.fillText).toHaveBeenCalledWith('🤖', expect.any(Number), expect.any(Number));
  });

  it('draws image avatars from a URL', async () => {
    const result = await renderAvatarToDataUrl('image-1', {
      avatar: 'https://example.com/avatar.png',
    });

    expect(result).toBe('data:image/png;base64,CANVAS');
    expect(context2d.drawImage).toHaveBeenCalled();
  });

  it('resolves undefined when the image fails to load', async () => {
    expect(
      await renderAvatarToDataUrl('image-broken', { avatar: 'https://example.com/broken.png' }),
    ).toBeUndefined();
  });

  it('caches renders per agent and avatar', () => {
    const meta = { avatar: '🐱', backgroundColor: '#fff' };

    const first = renderAvatarToDataUrl('cache-1', meta);
    const second = renderAvatarToDataUrl('cache-1', meta);

    expect(second).toBe(first);
  });

  it('resolves undefined when the canvas context is unavailable', async () => {
    vi.mocked(document.createElement).mockImplementation(
      () => ({ getContext: () => null, height: 0, toDataURL, width: 0 }) as any,
    );

    expect(await renderAvatarToDataUrl('no-context', { avatar: '🤖' })).toBeUndefined();
  });
});
