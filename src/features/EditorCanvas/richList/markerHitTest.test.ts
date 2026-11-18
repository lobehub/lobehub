import { afterEach, describe, expect, it, vi } from 'vitest';

import { findOrderedItemNear } from './markerHitTest';

const ITEM_HEIGHT = 20;

// A root holding one numbered list of `count` single-line items, laid out top
// to bottom the way the browser stacks them.
const setup = (count: number, inner = (index: number) => `<span>item ${index}</span>`) => {
  const root = document.createElement('div');
  root.innerHTML = `<p>intro</p><ol class="editor_listOrdered">${Array.from(
    { length: count },
    (_, index) => `<li>${inner(index)}</li>`,
  ).join('')}</ol>`;
  document.body.append(root);

  const list = root.querySelector('ol')!;
  const items = [...list.children] as HTMLLIElement[];
  const measured = vi.fn();
  for (const [index, item] of items.entries()) {
    item.getBoundingClientRect = () => {
      measured();
      return { bottom: (index + 1) * ITEM_HEIGHT, top: index * ITEM_HEIGHT } as DOMRect;
    };
  }

  return { items, list, measured, root };
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('findOrderedItemNear', () => {
  it('measures no item while the pointer is over ordinary text', () => {
    const { measured, root } = setup(1000);
    const paragraph = root.querySelector('p')!;

    expect(findOrderedItemNear(root, 100, 10, () => paragraph)).toBeUndefined();
    expect(measured).not.toHaveBeenCalled();
  });

  it('takes the item under the pointer without measuring any', () => {
    const { items, measured, root } = setup(1000);
    const text = items[500].querySelector('span')!;

    expect(findOrderedItemNear(root, 100, 10_010, () => text)).toBe(items[500]);
    expect(measured).not.toHaveBeenCalled();
  });

  it('finds the item beside the pointer in a long list by halving, not by scanning', () => {
    const { items, list, measured, root } = setup(1000);

    // Over the list's padding, level with item 742.
    expect(findOrderedItemNear(root, 4, 742 * ITEM_HEIGHT + 5, () => list)).toBe(items[742]);
    expect(measured.mock.calls.length).toBeLessThanOrEqual(10);
  });

  it('looks to the right when a long number hangs past the list edge', () => {
    const { items, root } = setup(3);
    const text = items[1].querySelector('span')!;
    // The pointer is left of the list, over the editor root; the item starts 32px on.
    const elementFromPoint = (x: number) => (x >= 32 ? text : root);

    expect(findOrderedItemNear(root, 0, 30, elementFromPoint)).toBe(items[1]);
  });

  it('skips an item that only holds a nested list', () => {
    const { items, root } = setup(2, (index) =>
      index === 1 ? '<ul><li><span>nested bullet</span></li></ul>' : '<span>plain</span>',
    );

    expect(findOrderedItemNear(root, 0, 30, () => items[1])).toBeUndefined();
    // Text in the nested bulleted list belongs to the bullet, not the wrapper.
    const bullet = items[1].querySelector('span')!;
    expect(findOrderedItemNear(root, 0, 30, () => bullet)).toBeUndefined();
  });

  it('ignores what lies outside the editor', () => {
    const { root } = setup(2);
    const outside = document.createElement('ol');
    outside.className = 'editor_listOrdered';
    outside.innerHTML = '<li><span>elsewhere</span></li>';
    document.body.append(outside);

    expect(findOrderedItemNear(root, 0, 10, () => outside.querySelector('span')!)).toBeUndefined();
  });
});
