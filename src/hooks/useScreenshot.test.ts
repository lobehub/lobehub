// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';

import { getImageUrl, ImageType } from './useScreenshot';

const toBlob = vi.hoisted(() => vi.fn());

vi.mock('@zumer/snapdom', () => ({ snapdom: { toBlob } }));

vi.mock('@lobechat/business-const', () => ({
  BRANDING_NAME: 'LobeHub',
}));

describe('getImageUrl', () => {
  it('captures raster images without placeholders or a third-party proxy', async () => {
    toBlob.mockResolvedValue(new Blob(['x'], { type: 'image/png' }));
    document.body.innerHTML = '<div id="preview"><img src="data:image/png;base64,aaa"/></div>';

    await getImageUrl({ imageType: ImageType.PNG });

    const options = toBlob.mock.calls[0][1];
    expect(options).toMatchObject({
      placeholders: false,
      type: 'png',
    });
    expect(options).not.toHaveProperty('useProxy');
  });
});
