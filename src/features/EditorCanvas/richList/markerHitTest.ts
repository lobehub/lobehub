const ORDERED_LIST = 'ol.editor_listOrdered';
const ORDERED_ITEM = `${ORDERED_LIST} > li`;

// A marker hangs left of its item: over the list's padding, or past the list's
// own edge when the number is long. So the item is under the pointer or within
// a few characters to its right.
const PROBE_OFFSETS = [0, 16, 32, 48, 64];

/** An item holding only a nested list has no number of its own. */
const isWrapperItem = (li: Element) => {
  const tag = li.firstElementChild?.tagName;
  return tag === 'OL' || tag === 'UL';
};

/** The item of `list` whose box spans `y`. Items stack top to bottom. */
const itemAt = (list: Element, y: number) => {
  const items = list.children;
  let low = 0;
  let high = items.length - 1;

  while (low <= high) {
    const middle = (low + high) >> 1;
    const item = items[middle];
    const { bottom, top } = item.getBoundingClientRect();
    if (y < top) high = middle - 1;
    else if (y > bottom) low = middle + 1;
    else return item.matches(ORDERED_ITEM) ? (item as HTMLLIElement) : undefined;
  }
};

const itemOf = (element: Element | null, root: HTMLElement, y: number) => {
  if (!element || !root.contains(element)) return;
  if (element.matches(ORDERED_LIST)) return itemAt(element, y);

  // The nearest item only: text in a bulleted list nested in a numbered one
  // belongs to the bullet.
  const item = element.closest('li');
  return item?.matches(ORDERED_ITEM) ? (item as HTMLLIElement) : undefined;
};

/**
 * The one numbered item whose marker could be under the pointer, found from
 * what is at the pointer instead of by measuring every item in the document.
 * The caller still checks the pointer against that item's marker box.
 */
export const findOrderedItemNear = (
  root: HTMLElement,
  x: number,
  y: number,
  elementFromPoint: (x: number, y: number) => Element | null = (px, py) =>
    document.elementFromPoint(px, py),
): HTMLLIElement | undefined => {
  for (const offset of PROBE_OFFSETS) {
    const item = itemOf(elementFromPoint(x + offset, y), root, y);
    if (item && !isWrapperItem(item)) return item;
  }
};
