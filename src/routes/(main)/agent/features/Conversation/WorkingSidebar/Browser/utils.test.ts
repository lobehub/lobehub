import { describe, expect, it } from 'vitest';

import {
  buildScreenshotFileName,
  createBrowserContext,
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

describe('createBrowserContext', () => {
  it('creates a selected-text context with its page source', () => {
    expect(
      createBrowserContext({
        content: '  Selected pull request feedback  ',
        id: 'context-1',
        pageTitle: 'Pull request #17159',
        selected: true,
        selectionTitle: 'Selected text',
        url: 'https://github.com/lobehub/lobehub/pull/17159',
      }),
    ).toEqual({
      content:
        'Source: https://github.com/lobehub/lobehub/pull/17159\n\nSelected pull request feedback',
      format: 'text',
      id: 'context-1',
      preview: 'Selected pull request feedback',
      source: 'text',
      title: 'Selected text: Pull request #17159',
      type: 'text',
    });
  });

  it('creates a page context and truncates its preview', () => {
    const content = 'A'.repeat(100);
    const context = createBrowserContext({
      content,
      id: 'context-2',
      pageTitle: 'LobeHub',
      selected: false,
      selectionTitle: 'Selected text',
      url: 'https://lobehub.com',
    });

    expect(context.title).toBe('LobeHub');
    expect(context.preview).toBe(`${'A'.repeat(80)}...`);
    expect(context.content).toBe(`Source: https://lobehub.com\n\n${content}`);
  });
});

describe('createElementContext', () => {
  it('builds a context chip carrying the element source, text and markup', () => {
    expect(
      createElementContext({
        element: {
          html: '<button class="go">Send</button>',
          selector: 'form > button.go',
          tag: 'button',
          text: 'Send',
        },
        elementTitle: 'Element',
        id: 'element-1',
        url: 'https://lobehub.com',
      }),
    ).toEqual({
      content:
        'Source: https://lobehub.com\nElement: form > button.go\n\nSend\n\n```html\n<button class="go">Send</button>\n```',
      format: 'text',
      id: 'element-1',
      preview: 'Send',
      source: 'text',
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
  it('slugs the page title and stamps the capture time', () => {
    expect(
      buildScreenshotFileName('Pull request #17436 · GitHub', new Date(2026, 6, 22, 9, 5, 7)),
    ).toBe('screenshot-Pull-request-17436-GitHub-20260722-090507.png');
  });

  it('falls back to a generic name when the page has no title', () => {
    expect(buildScreenshotFileName(undefined, new Date(2026, 0, 2, 3, 4, 5))).toBe(
      'screenshot-page-20260102-030405.png',
    );
  });
});
