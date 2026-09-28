// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getImageUrl, ImageType } from './useScreenshot';

const { snapdom, toBlob, toRaw } = vi.hoisted(() => {
  const toBlob = vi.fn();
  const snapdom = Object.assign(vi.fn(), { toBlob });

  return { snapdom, toBlob, toRaw: vi.fn() };
});

vi.mock('@zumer/snapdom', () => ({ snapdom }));

vi.mock('@lobechat/business-const', () => ({
  BRANDING_NAME: 'LobeHub',
}));

describe('getImageUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('captures raster images without placeholders or a third-party proxy', async () => {
    toBlob.mockResolvedValue(new Blob(['x'], { type: 'image/png' }));
    document.body.innerHTML = '<div id="preview"><img src="data:image/png;base64,aaa"/></div>';

    await getImageUrl({ imageType: ImageType.PNG, width: 640 });

    const options = toBlob.mock.calls[0][1];
    expect(options).toMatchObject({
      placeholders: false,
      scale: 2,
      type: 'png',
      width: 640,
    });
    expect(options).not.toHaveProperty('useProxy');
  });

  it('captures SVG images without placeholders or a third-party proxy', async () => {
    toRaw.mockReturnValue('<svg xmlns="http://www.w3.org/2000/svg"/>');
    snapdom.mockResolvedValue({ toRaw });
    document.body.innerHTML = '<div id="preview"><img src="data:image/png;base64,aaa"/></div>';

    await getImageUrl({ imageType: ImageType.SVG, width: 640 });

    const options = snapdom.mock.calls[0][1];
    expect(options).toMatchObject({
      placeholders: false,
      scale: 2,
      width: 640,
    });
    expect(options).not.toHaveProperty('useProxy');
    expect(toRaw).toHaveBeenCalledOnce();
  });
});
