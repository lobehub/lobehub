import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { wrapCanvasTree } from './providers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('wrapCanvasTree', () => {
  it('does not request CDN webfonts that the canvas CSP would block', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(wrapCanvasTree(createElement('span', null, 'x')));
    });

    const urls = [...document.querySelectorAll('link[href], style')].map(
      (node) => (node as HTMLLinkElement).href || node.textContent || '',
    );
    expect(container.textContent).toBe('x');
    expect(urls.filter((url) => /webfont|katex|npmmirror|jsdelivr|unpkg/.test(url))).toEqual([]);
    act(() => root.unmount());
  });
});
