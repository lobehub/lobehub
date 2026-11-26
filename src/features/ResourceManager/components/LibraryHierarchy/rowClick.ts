/** Wrapper class of a row's hover actions ("+" and "..."), see styles.ts. */
const ROW_ACTIONS_SELECTOR = '.hierarchy-node-actions';

interface RowClickEvent {
  currentTarget: EventTarget | null;
  target: EventTarget | null;
}

/**
 * Whether a click handled by a tree row was aimed at the row itself.
 *
 * The row's "+" and "..." stop propagation, but React still bubbles events
 * from anything they portal out (the dropdown menu, its submenus) through the
 * row, and a click on the active folder now collapses it. Checking the DOM
 * target keeps a stray action or menu click from toggling or navigating.
 */
export const isRowOwnClick = ({ currentTarget, target }: RowClickEvent): boolean => {
  if (!(currentTarget instanceof Node) || !(target instanceof Node)) return false;
  if (!currentTarget.contains(target)) return false;

  const element = target instanceof Element ? target : target.parentElement;
  return !element?.closest(ROW_ACTIONS_SELECTOR);
};

export type FolderRowClickAction = 'ignore' | 'navigate' | 'toggle';

/**
 * What a click on a folder row does. Opening a folder already expands it (the
 * sidebar expands the breadcrumb chain), so clicking the folder the explorer
 * already shows toggles it like the caret instead of re-navigating; any other
 * folder opens. Flat search-result rows have no caret and always open.
 */
export const resolveFolderRowClick = (
  event: RowClickEvent,
  { flat, isActive }: { flat?: boolean; isActive: boolean },
): FolderRowClickAction => {
  if (!isRowOwnClick(event)) return 'ignore';

  return isActive && !flat ? 'toggle' : 'navigate';
};
