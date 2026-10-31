import { afterEach, describe, expect, it, vi } from 'vitest';

import { commentAnchorId, commentAnchorUrl, commentIdFromHash, holdInView } from './anchor';

describe('comment anchors', () => {
  it('round-trips a comment id through the fragment', () => {
    const id = '9f1c2d3e-0000-4000-8000-000000000001';
    expect(commentIdFromHash(`#${commentAnchorId(id)}`)).toBe(id);
  });

  it('ignores fragments that address something else', () => {
    expect(commentIdFromHash('')).toBeUndefined();
    expect(commentIdFromHash('#')).toBeUndefined();
    // The page carries other fragments; only its own prefix may be claimed.
    expect(commentIdFromHash('#check-c2')).toBeUndefined();
    // A bare prefix names no comment.
    expect(commentIdFromHash('#comment-')).toBeUndefined();
  });

  it('links to this page under the app origin, not the renderer shell', () => {
    window.history.replaceState(null, '', '/lobehub/project/p1/acceptance/a1?round=2');

    expect(commentAnchorUrl('c1', 'https://app.lobehub.com')).toBe(
      'https://app.lobehub.com/lobehub/project/p1/acceptance/a1?round=2#comment-c1',
    );
  });
});

describe('comment links', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('links to the comment on the current report', () => {
    window.history.replaceState(null, '', '/acceptance/acc_1?r=2');

    expect(commentAnchorUrl('c1', window.location.origin)).toBe(
      `${window.location.origin}/acceptance/acc_1?r=2#${commentAnchorId('c1')}`,
    );
  });

  // The workspace-prefixed route is gated on membership; a shared link must open
  // for anyone the report is public to.
  it('drops the workspace prefix so the shared link opens outside the workspace', () => {
    window.history.replaceState(null, '', '/acme/acceptance/acc_1/check/chk_1?r=2');

    expect(commentAnchorUrl('c1', window.location.origin)).toBe(
      `${window.location.origin}/acceptance/acc_1/check/chk_1?r=2#${commentAnchorId('c1')}`,
    );
  });

  it('leaves a project-hosted report path alone', () => {
    window.history.replaceState(null, '', '/project/prj_1/acceptance/acc_1');

    expect(commentAnchorUrl('c1', window.location.origin)).toBe(
      `${window.location.origin}/project/prj_1/acceptance/acc_1#${commentAnchorId('c1')}`,
    );
  });
});

describe('holding a linked comment in view', () => {
  let resize: () => void = () => {};
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      disconnect() {
        resize = () => {};
      }
      observe() {}
    },
  );
  afterEach(() => vi.useRealTimers());

  const linked = () => {
    const scroller = document.createElement('div');
    scroller.style.overflowY = 'auto';
    const content = document.createElement('div');
    const element = document.createElement('div');
    content.append(element);
    scroller.append(content);
    document.body.append(scroller);
    element.scrollIntoView = vi.fn();
    return element;
  };

  // Screenshots above the comment load after the first scroll and push it away.
  it('re-centres the comment while the content above it grows', () => {
    const element = linked();
    holdInView(element, 4000);
    resize();
    expect(element.scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
  });

  it('lets go once the reader scrolls or the content settles', () => {
    vi.useFakeTimers();
    const element = linked();
    holdInView(element, 4000);
    window.dispatchEvent(new Event('wheel'));
    resize();
    expect(element.scrollIntoView).not.toHaveBeenCalled();

    const other = linked();
    holdInView(other, 4000);
    vi.advanceTimersByTime(4001);
    resize();
    expect(other.scrollIntoView).not.toHaveBeenCalled();
  });
});
