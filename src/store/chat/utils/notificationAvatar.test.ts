import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  NOTIFICATION_AVATAR_CACHE_LIMIT,
  NOTIFICATION_AVATAR_LOAD_TIMEOUT_MS,
  renderAvatarToDataUrl,
} from './notificationAvatar';

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
  static hang = false;
  crossOrigin = '';
  private listeners = new Map<string, () => void>();

  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, listener);
  }

  set src(value: string) {
    if (MockImage.hang || value.includes('stall')) return;
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
  MockImage.hang = false;
  vi.useRealTimers();
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

  it('resolves undefined when the image load times out', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const pending = renderAvatarToDataUrl('stall-1', {
      avatar: 'https://example.com/stall.png',
    });
    await vi.advanceTimersByTimeAsync(NOTIFICATION_AVATAR_LOAD_TIMEOUT_MS);

    expect(await pending).toBeUndefined();
  });

  it('retries after a timed-out avatar load', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    MockImage.hang = true;

    const pending = renderAvatarToDataUrl('retry-1', {
      avatar: 'https://example.com/retry.png',
    });
    await vi.advanceTimersByTimeAsync(NOTIFICATION_AVATAR_LOAD_TIMEOUT_MS);
    expect(await pending).toBeUndefined();

    MockImage.hang = false;
    vi.useRealTimers();

    expect(
      await renderAvatarToDataUrl('retry-1', { avatar: 'https://example.com/retry.png' }),
    ).toBe('data:image/png;base64,CANVAS');
  });

  it('evicts the oldest cached avatar once the cache is full', async () => {
    const firstMeta = { avatar: 'https://example.com/0.png' };
    const first = renderAvatarToDataUrl('agent-0', firstMeta);
    await first;

    for (let i = 1; i <= NOTIFICATION_AVATAR_CACHE_LIMIT; i += 1) {
      await renderAvatarToDataUrl(`agent-${i}`, { avatar: `https://example.com/${i}.png` });
    }

    const again = renderAvatarToDataUrl('agent-0', firstMeta);
    expect(again).not.toBe(first);
    expect(await again).toBe('data:image/png;base64,CANVAS');
  });

  it('keeps a recently reused avatar when the cache is full', async () => {
    const firstMeta = { avatar: 'https://example.com/keep.png' };
    const first = renderAvatarToDataUrl('keep', firstMeta);
    await first;

    for (let i = 0; i < NOTIFICATION_AVATAR_CACHE_LIMIT - 1; i += 1) {
      await renderAvatarToDataUrl(`fill-${i}`, { avatar: `https://example.com/fill-${i}.png` });
    }

    expect(renderAvatarToDataUrl('keep', firstMeta)).toBe(first);

    await renderAvatarToDataUrl('overflow', { avatar: 'https://example.com/overflow.png' });

    expect(renderAvatarToDataUrl('keep', firstMeta)).toBe(first);
  });
});
