/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from 'vitest';

import { isSubmitShortcutBlockedByTarget } from './submitShortcutGuard';

const el = (tag: string, attrs: Record<string, string> = {}): HTMLElement => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  document.body.append(node);
  return node;
};

describe('isSubmitShortcutBlockedByTarget', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('does NOT block on a null target or a plain non-interactive element', () => {
    expect(isSubmitShortcutBlockedByTarget(null)).toBe(false);
    expect(isSubmitShortcutBlockedByTarget(el('div'))).toBe(false);
    expect(isSubmitShortcutBlockedByTarget(el('span'))).toBe(false);
  });

  it('blocks on typing surfaces so Enter never hijacks text entry', () => {
    expect(isSubmitShortcutBlockedByTarget(el('input'))).toBe(true);
    expect(isSubmitShortcutBlockedByTarget(el('textarea'))).toBe(true);
    expect(isSubmitShortcutBlockedByTarget(el('div', { contenteditable: 'true' }))).toBe(true);
  });

  it('blocks on native interactive controls so Enter activates them, not the approval', () => {
    expect(isSubmitShortcutBlockedByTarget(el('button'))).toBe(true);
    expect(isSubmitShortcutBlockedByTarget(el('a'))).toBe(true);
    expect(isSubmitShortcutBlockedByTarget(el('select'))).toBe(true);
  });

  it('blocks when the target is nested inside an ARIA button/menuitem/option', () => {
    const menuItem = el('div', { role: 'menuitem' });
    const inner = document.createElement('span');
    menuItem.append(inner);
    expect(isSubmitShortcutBlockedByTarget(inner)).toBe(true);

    const option = el('div', { role: 'option' });
    expect(isSubmitShortcutBlockedByTarget(option)).toBe(true);
  });
});
