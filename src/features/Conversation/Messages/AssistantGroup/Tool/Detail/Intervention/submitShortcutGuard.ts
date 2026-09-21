/**
 * Whether a keydown landing on `target` must NOT trigger the window-level
 * approval submit shortcut (Enter / 1 / 2 / arrows).
 *
 * Two families of elements own their keys and must be left alone:
 * - typing surfaces (`input` / `textarea` / contenteditable) — hijacking Enter
 *   there would swallow the user's text or fire the main chat composer;
 * - interactive controls (`button` / `a` / `select`, or an ARIA
 *   `button` / `menuitem` / `option`) — Enter must activate that control, never
 *   silently submit the pending approval behind it.
 */
export const isSubmitShortcutBlockedByTarget = (target: HTMLElement | null): boolean => {
  if (!target) return false;

  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return true;
  if (tag === 'BUTTON' || tag === 'A' || tag === 'SELECT') return true;

  return Boolean(target.closest?.('[role="button"], [role="menuitem"], [role="option"]'));
};
