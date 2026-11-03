import { describe, expect, it, vi } from 'vitest';

import * as withTimeoutModule from '../../utils/withTimeout';
import { browserless } from '../browserless';

// Mock withTimeout to just call the factory function directly (bypassing real timeout)
vi.spyOn(withTimeoutModule, 'withTimeout').mockImplementation((fn) =>
  fn(new AbortController().signal),
);

describe('browserless', () => {
  it('should throw BrowserlessInitError when env vars not set', async () => {
    const originalEnv = { ...process.env };
    process.env = { ...originalEnv };
    delete process.env.BROWSERLESS_URL;
    delete process.env.BROWSERLESS_TOKEN;

    await expect(browserless('https://example.com', { filterOptions: {} })).rejects.toThrow(
      '`BROWSERLESS_URL` or `BROWSERLESS_TOKEN` are required',
    );

    process.env = originalEnv;
  });

  it('should throw NetworkConnectionError on fetch failed', async () => {
    process.env.BROWSERLESS_TOKEN = 'test-token';
    global.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));

    const { NetworkConnectionError } = await import('../../utils/errorType');
    await expect(browserless('https://example.com', { filterOptions: {} })).rejects.toThrow(
      NetworkConnectionError,
    );
  });

  it('should return undefined when content is empty', async () => {
    process.env.BROWSERLESS_TOKEN = 'test-token';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: vi.fn().mockResolvedValue('<html></html>'),
    } as any);

    const result = await browserless('https://example.com', { filterOptions: {} });
    expect(result).toBeUndefined();
  });

  it('should return undefined when title is "Just a moment..."', async () => {
    process.env.BROWSERLESS_TOKEN = 'test-token';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: vi.fn().mockResolvedValue('<html><title>Just a moment...</title></html>'),
    } as any);

    const result = await browserless('https://example.com', { filterOptions: {} });
    expect(result).toBeUndefined();
  });

  it('should return crawl result on successful fetch', async () => {
    process.env.BROWSERLESS_TOKEN = 'test-token';
    const longContent =
      'This is a test paragraph with enough content to pass the length check. '.repeat(3);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: vi.fn().mockResolvedValue(`
        <html>
          <head>
            <title>Test Title</title>
            <meta name="description" content="Test Description">
          </head>
          <body>
            <p>${longContent}</p>
          </body>
        </html>
      `),
    } as any);

    const result = await browserless('https://example.com', { filterOptions: {} });

    expect(result).toEqual({
      content: expect.any(String),
      contentType: 'text',
      description: expect.any(String),
      length: expect.any(Number),
      siteName: undefined,
      title: 'Test Title',
      url: 'https://example.com',
    });
  });

  it('should include rejectRequestPattern in request payload', async () => {
    process.env.BROWSERLESS_TOKEN = 'test-token';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: vi.fn().mockResolvedValue('<html><title>Test</title></html>'),
    });
    global.fetch = fetchMock;

    await browserless('https://example.com', { filterOptions: {} });

    const requestPayload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestPayload.rejectRequestPattern).toEqual([
      '.*\\.(?!(html|css|js|json|xml|webmanifest|txt|md)(\\?|#|$))[\\w-]+(?:[\\?#].*)?$',
    ]);
  });

  it('should allow requests to permitted file types', async () => {
    const allowedExtensions = ['html', 'css', 'js', 'json', 'xml', 'webmanifest', 'txt', 'md'];
    const pattern = /.*\.(?!(html|css|js|json|xml|webmanifest|txt|md)(\?|#|$))[\w-]+(?:[?#].*)?$/;

    allowedExtensions.forEach((ext) => {
      expect(`file.${ext}`).not.toMatch(pattern);
      expect(`file.${ext}?param=value`).not.toMatch(pattern);
      expect(`file.${ext}#hash`).not.toMatch(pattern);
    });
  });

  it('should reject requests to non-permitted file types', async () => {
    const rejectedExtensions = ['jpg', 'png', 'gif', 'pdf', 'doc', 'mp4', 'wav'];
    const pattern = /.*\.(?!(html|css|js|json|xml|webmanifest|txt|md)(\?|#|$))[\w-]+(?:[?#].*)?$/;

    rejectedExtensions.forEach((ext) => {
      expect(`file.${ext}`).toMatch(pattern);
      expect(`file.${ext}?param=value`).toMatch(pattern);
      expect(`file.${ext}#hash`).toMatch(pattern);
    });
  });

  it('should call fetch with the base URL and content path', async () => {
    const originalEnv = { ...process.env };
    process.env.BROWSERLESS_TOKEN = 'test-token';
    global.fetch = vi.fn().mockImplementation((url) => {
      // BASE_URL is captured at module load time, so we verify fetch is called with /content path
      expect(url).toContain('/content');
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: () => Promise.resolve('<html><title>Test</title></html>'),
      });
    });

    await browserless('https://example.com', { filterOptions: {} });

    expect(global.fetch).toHaveBeenCalled();

    process.env = originalEnv;
  });
});
