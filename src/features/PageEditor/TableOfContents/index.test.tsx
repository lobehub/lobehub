import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TableOfContents from './index';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// jsdom has no layout: keep the first heading at the pane top and the rest
// below the active threshold.
const setBody = (content: HTMLElement, html: string) => {
  content.innerHTML = `<div data-lexical-editor>${html}</div>`;
  for (const [index, heading] of [...content.querySelectorAll('h1, h2')].entries()) {
    heading.getBoundingClientRect = () => ({ top: index === 0 ? 0 : 500 }) as DOMRect;
  }
};

const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const setup = (onVisibleChange?: (visible: boolean) => void) => {
  const pane = document.createElement('div');
  const content = document.createElement('div');
  pane.append(content);
  document.body.append(pane);
  pane.scrollTo = vi.fn();
  Object.defineProperty(pane, 'scrollHeight', { configurable: true, value: 2000 });
  setBody(content, '<h1>Intro</h1><h2>Usage</h2><h2>FAQ</h2>');

  const view = render(
    <TableOfContents
      contentRef={{ current: content }}
      scrollRef={{ current: pane }}
      onVisibleChange={onVisibleChange}
    />,
  );
  return { content, pane, view };
};

const activeText = () =>
  screen.getAllByRole('link').find((el) => el.getAttribute('aria-current'))?.textContent;

let resizeCallbacks: Array<() => void> = [];

describe('TableOfContents', () => {
  beforeEach(() => {
    resizeCallbacks = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resizeCallbacks.push(callback);
        }
        disconnect() {}
        observe() {}
      },
    );
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('expands on keyboard focus and collapses when focus leaves', async () => {
    setup();
    await flush();

    expect(screen.queryAllByRole('link')).toHaveLength(0);

    fireEvent.focus(screen.getByRole('button'));
    expect(screen.getAllByRole('link').map((el) => el.textContent)).toEqual([
      'Intro',
      'Usage',
      'FAQ',
    ]);

    fireEvent.blur(screen.getByRole('button'), { relatedTarget: document.body });
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('drops the pinned heading when the document is replaced', async () => {
    const { content } = setup();
    await flush();

    fireEvent.focus(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('link', { name: 'FAQ' }));
    expect(activeText()).toBe('FAQ');

    setBody(content, '<h1>Other</h1><h2>Details</h2><h2>More</h2>');
    await flush();

    expect(activeText()).toBe('Other');
  });

  it('releases the pin on scrollbar pointer input', async () => {
    const { pane } = setup();
    await flush();

    fireEvent.focus(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('link', { name: 'FAQ' }));
    expect(activeText()).toBe('FAQ');

    fireEvent.pointerDown(pane);
    fireEvent.scroll(pane);
    expect(activeText()).toBe('Intro');
  });

  it('jumps without animation when reduced motion is preferred', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
    }));
    const { pane } = setup();
    await flush();

    fireEvent.focus(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('link', { name: 'FAQ' }));

    expect(pane.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
  });

  it('keeps the first heading active when the page fits without scrolling', async () => {
    const { pane } = setup();
    Object.defineProperty(pane, 'scrollHeight', { configurable: true, value: 0 });
    fireEvent.scroll(pane);
    await flush();

    fireEvent.focus(screen.getByRole('button'));
    expect(activeText()).toBe('Intro');
  });

  it('recomputes the active heading when layout changes without scrolling', async () => {
    const { pane } = setup();
    await flush();
    fireEvent.focus(screen.getByRole('button'));
    expect(activeText()).toBe('Intro');

    // A side panel opens and reflows the body: "Usage" moves above the threshold.
    for (const heading of pane.querySelectorAll('h1, h2')) {
      const top = heading.textContent === 'FAQ' ? 500 : 0;
      heading.getBoundingClientRect = () => ({ top }) as DOMRect;
    }
    act(() => {
      for (const callback of resizeCallbacks) callback();
    });

    expect(activeText()).toBe('Usage');
  });

  // The editor reserves room for the rail only while it is shown, so wide
  // tables stop short of it instead of running underneath.
  it('reports whether the rail is shown', async () => {
    const onVisibleChange = vi.fn();
    const { content, view } = setup(onVisibleChange);
    await flush();
    expect(onVisibleChange).toHaveBeenLastCalledWith(true);

    setBody(content, '<h1>Only one heading</h1>');
    await flush();
    expect(onVisibleChange).toHaveBeenLastCalledWith(false);

    setBody(content, '<h1>Intro</h1><h2>Usage</h2>');
    await flush();
    expect(onVisibleChange).toHaveBeenLastCalledWith(true);

    view.unmount();
    expect(onVisibleChange).toHaveBeenLastCalledWith(false);
  });
});
