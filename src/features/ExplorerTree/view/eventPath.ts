const isHTMLElement = (target: EventTarget): target is HTMLElement => target instanceof HTMLElement;

/** Tree path of the row an event came from, read off the composed (shadow-piercing) path. */
export const getItemPathFromEventPath = (path: EventTarget[]): string | null => {
  for (const target of path) {
    if (!isHTMLElement(target)) continue;
    const flattenedSegmentPath = target.getAttribute('data-item-flattened-subitem');
    if (flattenedSegmentPath) return flattenedSegmentPath;
    if (target.dataset.type !== 'item') continue;
    const path = target.dataset.itemPath;
    if (path) return path;
  }

  return null;
};

/**
 * Whether an event landed on a row's icon slot — the chevron on a container row.
 * Lets a container that also opens on click (a document with nested documents)
 * keep the chevron as a pure expand/collapse toggle.
 */
export const isItemToggleEventPath = (path: EventTarget[]): boolean => {
  for (const target of path) {
    if (!isHTMLElement(target)) continue;
    if (target.dataset.itemSection === 'icon') return true;
    if (target.dataset.type === 'item') return false;
  }

  return false;
};
