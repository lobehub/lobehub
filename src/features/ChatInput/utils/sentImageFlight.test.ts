import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UploadFileItem } from '@/types/files/upload';

import { CHAT_INPUT_IMAGE_ATTR, flySentImages } from './sentImageFlight';

const rect = (left: number, top: number, size: number) =>
  ({ height: size, left, top, width: size }) as DOMRect;

const image = (overrides: Partial<UploadFileItem> = {}): UploadFileItem =>
  ({
    file: new File(['x'], 'image.png', { type: 'image/png' }),
    fileUrl: 'https://cdn/image.png',
    id: 'file-1',
    previewUrl: 'blob:a',
    status: 'success',
    ...overrides,
  }) as UploadFileItem;

const mountThumbnail = (key: string) => {
  const img = document.createElement('img');
  img.setAttribute(CHAT_INPUT_IMAGE_ATTR, key);
  img.src = key;
  img.getBoundingClientRect = () => rect(10, 500, 112);
  document.body.append(img);
  return img;
};

const ghosts = () =>
  [...document.querySelectorAll('img[aria-hidden="true"]')] as HTMLImageElement[];

describe('flySentImages', () => {
  let animations: { finish: () => void; keyframes: Keyframe[] }[];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'performance', 'setTimeout'] });
    animations = [];
    Element.prototype.animate = vi.fn(function (this: Element, keyframes: Keyframe[]) {
      const animation = { oncancel: null, onfinish: null } as any;
      animations.push({ finish: () => animation.onfinish?.(), keyframes });
      return animation;
    }) as any;
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as any;
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('flies a copy of the thumbnail onto the image the sent message renders', () => {
    mountThumbnail('blob:a');
    flySentImages([image()]);
    expect(ghosts()).toHaveLength(1);

    const target = document.createElement('img');
    target.src = 'https://cdn/image.png';
    target.getBoundingClientRect = () => rect(300, 100, 200);
    document.body.append(target);
    vi.advanceTimersByTime(100);

    expect(target.style.visibility).toBe('hidden');
    expect(animations[0].keyframes.at(-1)).toMatchObject({ left: '300px', top: '100px' });

    animations[0].finish();
    expect(ghosts()).toHaveLength(0);
    expect(target.style.visibility).toBe('');
  });

  it('fades the copy out when the message never renders the image', () => {
    mountThumbnail('blob:a');
    flySentImages([image()]);

    vi.advanceTimersByTime(2500);
    expect(animations).toHaveLength(1);
    expect(animations[0].keyframes).toEqual([{ opacity: 1 }, { opacity: 0 }]);
  });

  it('does not fly into an earlier message showing the same image', () => {
    const earlier = document.createElement('img');
    earlier.src = 'https://cdn/image.png';
    earlier.getBoundingClientRect = () => rect(300, 100, 200);
    document.body.append(earlier);
    mountThumbnail('blob:a');
    flySentImages([image()]);

    vi.advanceTimersByTime(2500);
    expect(earlier.style.visibility).toBe('');
    expect(animations).toHaveLength(1);
    expect(animations[0].keyframes).toEqual([{ opacity: 1 }, { opacity: 0 }]);
  });

  it('does nothing under reduced motion', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as any;
    mountThumbnail('blob:a');

    flySentImages([image()]);

    expect(ghosts()).toHaveLength(0);
  });

  it('flies at most four images', () => {
    const files = Array.from({ length: 6 }, (_, i) =>
      image({ id: `file-${i}`, previewUrl: `blob:${i}` }),
    );
    files.forEach((file) => mountThumbnail(file.previewUrl!));

    flySentImages(files);

    expect(ghosts()).toHaveLength(4);
  });
});
