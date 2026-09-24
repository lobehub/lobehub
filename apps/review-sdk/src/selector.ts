// A stable, readable CSS selector for the element a reviewer pointed at: prefer
// data-testid / id / aria-label, fall back to a positional path.

/** Only these members of a DOM Element, so the logic runs in node tests. */
export interface SelectorNode {
  children: ArrayLike<SelectorNode>;
  getAttribute: (name: string) => string | null;
  id: string;
  parentElement: SelectorNode | null;
  tagName: string;
}

const STABLE_ATTRIBUTES = ['data-testid', 'data-review-id', 'aria-label', 'name'] as const;
/** Ids that look generated (long hex runs, css-in-js hashes, React ids) are not stable. */
const looksGenerated = (value: string) =>
  /[0-9a-f]{6,}|^(?:css|acss|ant)-|:r[0-9a-z]+:/i.test(value);
const escape = (value: string) => value.replaceAll(/["\\]/g, '\\$&');

function stableSelector(node: SelectorNode): string | null {
  const tag = node.tagName.toLowerCase();
  if (node.id && !looksGenerated(node.id)) return `#${node.id}`;
  for (const attribute of STABLE_ATTRIBUTES) {
    const value = node.getAttribute(attribute);
    if (value && !looksGenerated(value) && value.length <= 80)
      return `${attribute === 'data-testid' || attribute === 'data-review-id' ? '' : tag}[${attribute}="${escape(value)}"]`;
  }
  return null;
}

function positional(node: SelectorNode) {
  const tag = node.tagName.toLowerCase();
  const parent = node.parentElement;
  if (!parent) return tag;
  const siblings = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
  return siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(node) + 1})` : tag;
}

export function selectorFor(node: SelectorNode, maxDepth = 6): string {
  const parts: string[] = [];
  let current: SelectorNode | null = node;
  while (current && parts.length < maxDepth) {
    const tag = current.tagName.toLowerCase();
    if (tag === 'body' || tag === 'html') break;
    const stable = stableSelector(current);
    if (stable) {
      parts.unshift(stable);
      // An ancestor with an id or test id already pins it down.
      if (stable.startsWith('#') || stable.startsWith('[data-')) break;
    } else {
      parts.unshift(positional(current));
    }
    current = current.parentElement;
  }
  return parts.join(' > ');
}

/** The element's visible text on one line, truncated: a way to find it when the selector drifts. */
export const elementTextOf = (text: string | null | undefined, max = 120) => {
  const collapsed = (text ?? '').replaceAll(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
};
