import { describe, expect, it } from 'vitest';

import {
  buildScreenshotFileName,
  createElementContext,
  dataUrlToFile,
  normalizeBrowserUrl,
} from './utils';

describe('normalizeBrowserUrl', () => {
  it('keeps explicit http URLs', () => {
    expect(normalizeBrowserUrl('https://lobehub.com')).toBe('https://lobehub.com');
  });

  it('normalizes hostnames and local dev URLs', () => {
    expect(normalizeBrowserUrl('lobehub.com')).toBe('https://lobehub.com');
    expect(normalizeBrowserUrl('localhost:3000')).toBe('http://localhost:3000');
    expect(normalizeBrowserUrl('127.0.0.1:9876')).toBe('http://127.0.0.1:9876');
  });

  it('turns plain text into a search URL', () => {
    expect(normalizeBrowserUrl('lobe browser feature')).toBe(
      'https://www.bing.com/search?q=lobe+browser+feature',
    );
  });
});

describe('createElementContext', () => {
  it('builds a first-class element context: text for the model, structure for the chip', () => {
    expect(
      createElementContext({
        element: {
          html: '<button class="go">Send</button>',
          pageTitle: 'LobeHub',
          selector: 'form > button.go',
          tag: 'button',
          text: 'Send',
          thumbnailUrl: 'data:image/jpeg;base64,thumb',
          url: 'https://lobehub.com',
        },
        elementTitle: 'Element',
        id: 'element-1',
      }),
    ).toEqual({
      content:
        'Source: https://lobehub.com\nElement: form > button.go\n\nSend\n\n```html\n<button class="go">Send</button>\n```',
      element: {
        pageTitle: 'LobeHub',
        selector: 'form > button.go',
        tag: 'button',
        thumbnailUrl: 'data:image/jpeg;base64,thumb',
        url: 'https://lobehub.com',
      },
      format: 'text',
      id: 'element-1',
      preview: 'Send',
      source: 'element',
      title: 'Element: form > button.go',
      type: 'text',
    });
  });

  it('falls back to the tag for elements without a selector or text', () => {
    const context = createElementContext({
      element: { html: '<img src="/logo.png">', selector: '', tag: 'img', text: '' },
      elementTitle: 'Element',
      id: 'element-2',
    });

    expect(context.title).toBe('Element: <img>');
    expect(context.content).toBe('Element: <img>\n\n```html\n<img src="/logo.png">\n```');
    expect(context.preview).toBe('<img src="/logo.png">');
    expect(context.source).toBe('element');
    expect(context.element).toEqual({
      pageTitle: undefined,
      selector: '',
      tag: 'img',
      thumbnailUrl: undefined,
      url: undefined,
    });
  });
});

describe('dataUrlToFile', () => {
  it('decodes a captured data URL into an image file for the upload pipeline', async () => {
    const file = dataUrlToFile(`data:image/png;base64,${btoa('fake-png-bytes')}`, 'shot.png');

    expect(file.name).toBe('shot.png');
    expect(file.type).toBe('image/png');
    expect(await file.text()).toBe('fake-png-bytes');
  });
});

describe('buildScreenshotFileName', () => {
  it('slugs the page title and stamps the capture time down to the millisecond', () => {
    expect(
      buildScreenshotFileName('Pull request #17436 · GitHub', new Date(2026, 6, 22, 9, 5, 7, 42)),
    ).toBe('screenshot-Pull-request-17436-GitHub-20260722-090507-042.png');
  });

  it('falls back to a generic name when the page has no title', () => {
    expect(buildScreenshotFileName(undefined, new Date(2026, 0, 2, 3, 4, 5, 0))).toBe(
      'screenshot-page-20260102-030405-000.png',
    );
  });

  it('keeps same-second captures distinct — the upload list keys drafts by file name', () => {
    const first = buildScreenshotFileName('Page', new Date(2026, 6, 22, 9, 5, 7, 100));
    const second = buildScreenshotFileName('Page', new Date(2026, 6, 22, 9, 5, 7, 350));
    expect(first).not.toBe(second);
  });
});
