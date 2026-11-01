import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadCanvasAddon, resolveCanvasAddonUrl } from './load';
import { registerCanvasAddon } from './registry';

let appended: HTMLScriptElement[] = [];

beforeEach(() => {
  appended = [];
  vi.spyOn(document.head, 'append').mockImplementation((...nodes) => {
    appended.push(...(nodes as HTMLScriptElement[]));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.__LOBE_CANVAS_ADDONS__;
});

describe('canvas add-ons', () => {
  it('resolves add-ons next to the runtime script, not the project page', () => {
    expect(
      resolveCanvasAddonUrl(
        'mermaid',
        'https://app.lobehub.com/canvas-runtime/v1/canvas-runtime.js',
      ),
    ).toBe('https://app.lobehub.com/canvas-runtime/v1/canvas-runtime-mermaid.js');
  });

  it('loads an add-on script once and resolves with what it registers', async () => {
    const first = loadCanvasAddon('mermaid');
    const second = loadCanvasAddon('mermaid');

    expect(appended).toHaveLength(1);
    expect(appended[0].src).toContain('canvas-runtime-mermaid.js');

    const addon = { render: () => ({ svg: '<svg></svg>' }) };
    registerCanvasAddon('mermaid', addon);
    appended[0].dispatchEvent(new Event('load'));

    await expect(first).resolves.toBe(addon);
    await expect(second).resolves.toBe(addon);
  });

  it('rejects when the add-on script cannot be fetched, so a later call can retry', async () => {
    const failed = loadCanvasAddon('highlight');
    appended[0].dispatchEvent(new Event('error'));

    await expect(failed).rejects.toThrow('highlight add-on failed to load');

    void loadCanvasAddon('highlight');
    expect(appended).toHaveLength(2);
  });
});
