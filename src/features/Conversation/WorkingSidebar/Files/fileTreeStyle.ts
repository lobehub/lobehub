import { FOLDER_ICON_CSS } from '@/features/ExplorerTree';

const IGNORED_FILE_OPACITY_CSS = `
[data-item-git-status='ignored'] > :where(
  [data-item-section='icon'],
  [data-item-section='content'],
  [data-item-section='decoration'],
  [data-item-section='git']
) {
  opacity: 0.7;
}`;

// The selected fill already marks the current row. pierre still rings a row
// that holds :focus-visible, and it grants that after programmatic focus too —
// so a row we select and focus after create / duplicate / paste gets a stray
// white outline. Drop the ring in every state; a row holding real keyboard
// focus but not selected borrows the hover fill so arrowing stays visible.
// Key the fill on :focus-visible, not data-item-focused: pierre keeps that
// roving marker on a row (the root, initially) even while the tree is blurred,
// which would leave a second, phantom highlight.
const NO_FOCUS_RING_CSS = `
[data-type='item'][data-item-focused='true']::before,
[data-type='item']:focus-visible::before {
  outline: none;
}

[data-type='item']:focus-visible:not([data-item-selected='true']) {
  background-color: var(--trees-bg-muted);
}`;

// pierre sizes the name to its text and hides the flexible decoration spacer
// while the rename input is open, so the git lane ("A", "M") slides in right
// after the input, mid-row. Let the input take the spacer's place so the
// status letter stays at the row's end, where every other row shows it.
const RENAME_INPUT_FULL_WIDTH_CSS = `
[data-item-section='content']:has([data-item-rename-input]) {
  flex: 1 1 0;
}`;

export const FILE_TREE_UNSAFE_CSS = [
  FOLDER_ICON_CSS,
  NO_FOCUS_RING_CSS,
  IGNORED_FILE_OPACITY_CSS,
  RENAME_INPUT_FULL_WIDTH_CSS,
].join('\n');
