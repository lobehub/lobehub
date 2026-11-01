/**
 * @vitest-environment happy-dom
 */
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useScrollActiveThreadIntoView } from './useScrollActiveThreadIntoView';

interface HarnessProps {
  activeId?: string | null;
  ids: string[];
}

const Harness = ({ activeId, ids }: HarnessProps) => {
  const ref = useScrollActiveThreadIntoView(activeId, ids.length);
  return (
    <div ref={ref}>
      {ids.map((id) => (
        <div data-thread-id={id} key={id}>
          row-{id}
        </div>
      ))}
    </div>
  );
};

const makeIds = (count: number) => Array.from({ length: count }, (_, i) => `t${i}`);

// Capture every scrollIntoView call together with the element it was called on,
// regardless of whether the DOM env provides a native implementation.
const calls: { el: Element; options: unknown }[] = [];
const originalScrollIntoView = Element.prototype.scrollIntoView;

beforeEach(() => {
  calls.length = 0;
  Element.prototype.scrollIntoView = vi.fn(function (this: Element, options: unknown) {
    calls.push({ el: this, options });
  });
});

afterEach(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

describe('useScrollActiveThreadIntoView', () => {
  it('scrolls the active row into view when it sits below the visible rows', () => {
    const ids = makeIds(16);
    const { container } = render(<Harness activeId={'t12'} ids={ids} />);

    const activeRow = container.querySelector('[data-thread-id="t12"]');

    expect(calls).toHaveLength(1);
    expect(calls[0].el).toBe(activeRow);
    // `block: 'nearest'` keeps an already-visible row put.
    expect(calls[0].options).toEqual({ block: 'nearest' });
  });

  it('does nothing when there is no active thread', () => {
    render(<Harness activeId={undefined} ids={makeIds(16)} />);

    expect(calls).toHaveLength(0);
  });

  it('does nothing when the active thread is not in the rendered list', () => {
    render(<Harness activeId={'missing'} ids={makeIds(16)} />);

    expect(calls).toHaveLength(0);
  });

  it('scrolls once the async-fetched rows mount (ready signal changes)', () => {
    // Topic opened with a restored activeThreadId before threads have loaded.
    const { rerender, container } = render(<Harness activeId={'t5'} ids={[]} />);
    expect(calls).toHaveLength(0);

    // Threads arrive: the effect re-runs because `ready` (length) changed.
    rerender(<Harness activeId={'t5'} ids={makeIds(10)} />);

    expect(calls).toHaveLength(1);
    expect(calls[0].el).toBe(container.querySelector('[data-thread-id="t5"]'));
  });
});
