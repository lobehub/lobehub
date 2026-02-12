import { describe, expect, it, vi } from 'vitest';

import { browserless } from '../browserless';

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

  it('should return undefined on fetch error', async () => {
    process.env.BROWSERLESS_TOKEN = 'test-token';
    global.fetch = vi.fn().mockRejectedValue(new Error('Fetch error'));

    const result = await browserless('https://example.com', { filterOptions: {} });
    expect(result).toBeUndefined();
  });

  it('should return undefined when content is empty', async () => {
    process.env.BROWSERLESS_TOKEN = 'test-token';
    global.fetch = vi.fn().mockResolvedValue({
      text: vi.fn().mockResolvedValue('<html></html>'),
    } as any);

    const result = await browserless('https://example.com', { filterOptions: {} });
    expect(result).toBeUndefined();
  });

  it('should return undefined when title is "Just a moment..."', async () => {
    process.env.BROWSERLESS_TOKEN = 'test-token';
    global.fetch = vi.fn().mockResolvedValue({
      text: vi.fn().mockResolvedValue('<html><title>Just a moment...</title></html>'),
    } as any);

    const result = await browserless('https://example.com', { filterOptions: {} });
    expect(result).toBeUndefined();
  });

  it('should return crawl result on successful fetch', async () => {
    process.env.BROWSERLESS_TOKEN = 'test-token';
    global.fetch = vi.fn().mockResolvedValue({
      text: vi.fn().mockResolvedValue(`
        <html>
          <head>
            <title>Test Title</title>
            <meta name="description" content="Test Description">
          </head>
          <body>
            <h1>Test Content</h1>
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
    const pattern = new RegExp(
      '.*\\.(?!(html|css|js|json|xml|webmanifest|txt|md)(\\?|#|$))[\\w-]+(?:[?#].*)?$',
    );

    allowedExtensions.forEach((ext) => {
      expect(`file.${ext}`).not.toMatch(pattern);
      expect(`file.${ext}?param=value`).not.toMatch(pattern);
      expect(`file.${ext}#hash`).not.toMatch(pattern);
    });
  });

  it('should reject requests to non-permitted file types', async () => {
    const rejectedExtensions = ['jpg', 'png', 'gif', 'pdf', 'doc', 'mp4', 'wav'];
    const pattern = new RegExp(
      '.*\\.(?!(html|css|js|json|xml|webmanifest|txt|md)(\\?|#|$))[\\w-]+(?:[?#].*)?$',
    );

    rejectedExtensions.forEach((ext) => {
      expect(`file.${ext}`).toMatch(pattern);
      expect(`file.${ext}?param=value`).toMatch(pattern);
      expect(`file.${ext}#hash`).toMatch(pattern);
    });
  });

  it('should use correct URL when BROWSERLESS_URL is provided', async () => {
    const customUrl = 'https://custom.browserless.io';
    const originalEnv = { ...process.env };
    process.env.BROWSERLESS_TOKEN = 'test-token';
    process.env.BROWSERLESS_URL = customUrl;
    global.fetch = vi.fn().mockImplementation((url) => {
      expect(url).toContain(customUrl);
      return Promise.resolve({
        text: () => Promise.resolve('<html><title>Test</title></html>'),
      });
    });

    await browserless('https://example.com', { filterOptions: {} });

    expect(global.fetch).toHaveBeenCalled();

    process.env = originalEnv;
  });
});
