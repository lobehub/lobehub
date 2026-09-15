export interface MenuOpenChangeDetails {
  cancel?: () => void;
  event?: Event;
  reason?: string;
}

/**
 * Rows in the chat-input menus open companion surfaces that portal outside the
 * menu DOM — the per-row skill policy popover, its uninstall confirm in the
 * global modal host, detail cards. base-ui resolves a press or focus move
 * landing on such a surface as an outside interaction and dismisses the whole
 * menu chain, so a user acting inside the companion loses the menu underneath.
 * A close caused by a press/focus inside any dialog-role overlay must be
 * vetoed, for the root menu and every submenu alike.
 */
export const shouldVetoMenuClose = (details: MenuOpenChangeDetails | undefined): boolean => {
  const reason = details?.reason;
  if (reason !== 'outside-press' && reason !== 'focus-out') return false;
  const event = details?.event;
  const nodes: (EventTarget | null)[] = [event?.target ?? null];
  if (event && 'relatedTarget' in event) {
    nodes.push((event as FocusEvent).relatedTarget);
  }
  return nodes.some(
    (node) =>
      node instanceof Element && node.closest('[role="dialog"],[role="alertdialog"]') !== null,
  );
};
