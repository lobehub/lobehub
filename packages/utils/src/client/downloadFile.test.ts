/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadFile } from './downloadFile';

const PROXY_URL = 'https://app.test/f/file_1';
const RESOLVE = { resolveExtension: true };

let downloadName: string | undefined;

const mockResponse = ({
  mimeType = 'image/png',
  ok = true,
  url = 'https://cdn.test/lobe/object.png',
}: {
  mimeType?: string;
  ok?: boolean;
  url?: string;
} = {}) => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      blob: async () => new Blob(['payload'], { type: mimeType }),
      ok,
      status: ok ? 200 : 404,
      statusText: ok ? 'OK' : 'Not Found',
      url,
    }),
  );
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  downloadName = undefined;

  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloadName = this.download;
  });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

describe('downloadFile', () => {
  it('uses the given name unchanged when extension resolution is not requested', async () => {
    mockResponse();

    await downloadFile(PROXY_URL, 'report_2026-08-12.', false);

    expect(downloadName).toBe('report_2026-08-12.');
  });

  it('appends the extension the response reports when the name has none', async () => {
    mockResponse({ mimeType: 'image/png' });

    await downloadFile(PROXY_URL, 'sunset_2026-08-12_18-04-53', false, RESOLVE);

    expect(downloadName).toBe('sunset_2026-08-12_18-04-53.png');
  });

  // A file proxy URL carries no extension, so the caller's name ends in a bare dot.
  // Browsers rewrite that dot and then read the text after the last remaining dot as
  // the extension, so a name that contains a period of its own used to keep a
  // nonsense extension and the file arrived without a usable one.
  it('resolves the extension for a name whose own text contains a period', async () => {
    mockResponse({ mimeType: 'image/png' });

    await downloadFile(PROXY_URL, 'Mr._Smith_in_a_paper_cup._2026-08-12_18-31-27.', false, RESOLVE);

    expect(downloadName).toBe('Mr._Smith_in_a_paper_cup._2026-08-12_18-31-27.png');
  });

  it('does not append a second extension when the name already carries the right one', async () => {
    mockResponse({ mimeType: 'image/png' });

    await downloadFile(PROXY_URL, 'sunset.png', false, RESOLVE);

    expect(downloadName).toBe('sunset.png');
  });

  // `mime` maps image/jpeg to `jpg` and image/tiff to `tif`, so a name that already
  // spells the extension out must not gain a second one.
  it('treats jpeg as equivalent to the jpg the response maps to', async () => {
    mockResponse({ mimeType: 'image/jpeg' });

    await downloadFile(PROXY_URL, 'sunset.jpeg', false, RESOLVE);

    expect(downloadName).toBe('sunset.jpeg');
  });

  it('treats tiff as equivalent to the tif the response maps to', async () => {
    mockResponse({ mimeType: 'image/tiff' });

    await downloadFile(PROXY_URL, 'scan.tiff', false, RESOLVE);

    expect(downloadName).toBe('scan.tiff');
  });

  it('replaces a recognized extension that contradicts the downloaded content', async () => {
    mockResponse({ mimeType: 'image/jpeg', url: 'https://cdn.test/lobe/object.jpg' });

    await downloadFile(PROXY_URL, 'photo.png', false, RESOLVE);

    expect(downloadName).toBe('photo.jpg');
  });

  // `mime` knows nothing about this extension, so the media-type comparison cannot
  // recognise it; matching the spelling is what stops the name from doubling up.
  it('does not duplicate an extension the media-type table does not know', async () => {
    mockResponse({ mimeType: '', url: 'https://cdn.test/lobe/archive.abc' });

    await downloadFile(PROXY_URL, 'archive.abc', false, RESOLVE);

    expect(downloadName).toBe('archive.abc');
  });

  it('falls back to the final url when the response type is not informative', async () => {
    mockResponse({
      mimeType: 'application/octet-stream',
      url: 'https://cdn.test/lobe/generations/images/abc_raw.webp?X-Amz-Expires=7200',
    });

    await downloadFile(PROXY_URL, 'sunset_2026-08-12.', false, RESOLVE);

    expect(downloadName).toBe('sunset_2026-08-12.webp');
  });

  // `Response.blob()` keeps Content-Type parameters, and `mime` ignores them — a
  // parameterized octet-stream must be rejected the same way as the bare form
  // instead of resolving to `.bin`.
  it('ignores a parameterized octet-stream type and falls back to the final url', async () => {
    mockResponse({
      mimeType: 'application/octet-stream;charset=binary',
      url: 'https://cdn.test/lobe/generations/images/abc_raw.webp',
    });

    await downloadFile(PROXY_URL, 'sunset_2026-08-12.', false, RESOLVE);

    expect(downloadName).toBe('sunset_2026-08-12.webp');
  });

  // Responses without a final url (e.g. synthesized by a service worker) report
  // `response.url` as `''`; the request url is the only address left to read.
  it('falls back to the request url when the response reports no final url', async () => {
    mockResponse({ mimeType: '', url: '' });

    await downloadFile('https://cdn.test/lobe/photo.png', 'sunset_2026-08-12', false, RESOLVE);

    expect(downloadName).toBe('sunset_2026-08-12.png');
  });

  // The media-type table knows nothing about this extension, so only the spelling
  // in the final url can supply it; a name with no extension must still gain it.
  it('appends an extension the media-type table does not know when the name has none', async () => {
    mockResponse({ mimeType: '', url: 'https://cdn.test/lobe/frame.zzz' });

    await downloadFile(PROXY_URL, 'clip_2026-08-12', false, RESOLVE);

    expect(downloadName).toBe('clip_2026-08-12.zzz');
  });

  it('leaves the name without an extension when neither source resolves one', async () => {
    mockResponse({ mimeType: '', url: PROXY_URL });

    await downloadFile(PROXY_URL, 'sunset_2026-08-12.', false, RESOLVE);

    expect(downloadName).toBe('sunset_2026-08-12');
  });

  it('ignores a dot that belongs to a directory segment of the final url', async () => {
    mockResponse({ mimeType: '', url: 'https://cdn.test/v1.2/download' });

    await downloadFile(PROXY_URL, 'sunset_2026-08-12.', false, RESOLVE);

    expect(downloadName).toBe('sunset_2026-08-12');
  });

  it('rethrows when the fetch fails and the open fallback is disabled', async () => {
    mockResponse({ ok: false });

    await expect(downloadFile(PROXY_URL, 'sunset.png', false, RESOLVE)).rejects.toThrow(
      'Failed to fetch image',
    );
  });

  it('opens the url in a new tab when the fetch fails and the fallback is enabled', async () => {
    mockResponse({ ok: false });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);

    await downloadFile(PROXY_URL, 'sunset.png');

    expect(open).toHaveBeenCalledWith(PROXY_URL);
  });
});
