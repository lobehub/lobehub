import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { followFeedBottom } from './feedFollow';

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observed = new Set<Element>();
  constructor(private callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }
  observe(target: Element) {
    this.observed.add(target);
  }
  unobserve(target: Element) {
    this.observed.delete(target);
  }
  disconnect() {
    this.observed.clear();
  }
  /** Reports a size change of `target` the way the browser would after layout. */
  resize(target: Element) {
    if (this.observed.has(target)) this.callback([], this as unknown as ResizeObserver);
  }
}

const resize = (target: Element) => {
  for (const observer of FakeResizeObserver.instances) observer.resize(target);
};

const createFeed = () => {
  const feed = document.createElement('div');
  const content = document.createElement('div');
  feed.append(content);
  document.body.append(feed);
  let scrollHeight = 1000;
  Object.defineProperty(feed, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  feed.scrollTop = 0;
  return {
    content,
    feed,
    grow: (by: number) => {
      scrollHeight += by;
    },
  };
};

describe('followFeedBottom', () => {
  beforeEach(() => {
    FakeResizeObserver.instances = [];
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('keeps a pinned reader on the foot when a row grows after it rendered', () => {
    const { content, feed, grow } = createFeed();
    followFeedBottom(feed, () => true);

    // A card's chart settles its height after the first paint.
    grow(320);
    resize(content);

    expect(feed.scrollTop).toBe(1320);
  });

  it('leaves a reader who scrolled up where they are', () => {
    const { content, feed, grow } = createFeed();
    feed.scrollTop = 200;
    followFeedBottom(feed, () => false);

    grow(320);
    resize(content);

    expect(feed.scrollTop).toBe(200);
  });

  it('follows the feed itself shrinking under a taller composer', () => {
    const { feed } = createFeed();
    followFeedBottom(feed, () => true);

    resize(feed);

    expect(feed.scrollTop).toBe(1000);
  });

  it('follows children that replace the first content', async () => {
    const { content, feed, grow } = createFeed();
    followFeedBottom(feed, () => true);
    const replacement = document.createElement('div');
    content.replaceWith(replacement);
    // MutationObserver records are delivered as a microtask.
    await Promise.resolve();

    grow(80);
    resize(replacement);

    expect(feed.scrollTop).toBe(1080);
  });

  it('stops following once cleaned up', () => {
    const { content, feed, grow } = createFeed();
    const stop = followFeedBottom(feed, () => true);
    stop();

    grow(320);
    resize(content);

    expect(feed.scrollTop).toBe(0);
  });
});
