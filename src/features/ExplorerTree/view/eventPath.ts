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
