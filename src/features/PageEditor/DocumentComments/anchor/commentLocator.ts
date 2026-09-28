import { styles } from '../styles';

/** How long a located card / anchor keeps its emphasis before settling back. */
export const LOCATE_FLASH_DURATION = 2400;

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const scrollBehavior = (): ScrollBehavior => (prefersReducedMotion() ? 'auto' : 'smooth');

/**
 * Flash a comment card, the same landing treatment a notification deep link
 * gets (see `CommentCard`'s `focusToken` effect).
 *
 * `scroll: false` requests skipping the scroll a deep link otherwise gets,
 * for a click in the body whose card sits (or is about to sit, once a closed
 * panel opens) in a gutter beside the run — but it's only honoured there; a
 * card with no gutter to sit in can be anywhere on the page, so it is always
 * scrolled into view or the click would land on nothing visible.
 *
 * `hasGutter` is the caller's own answer to "will this land in a gutter",
 * for when the DOM can't say yet: opening a closed panel is a separate,
 * slightly later effect, so at click time the gutter copy of the card may
 * not be mounted and the query would otherwise fall through to the flat
 * list's copy — inferring "no gutter" from that would scroll away right as
 * the panel is about to open beside the very text that was clicked.
 */
export const focusCommentCard = (
  commentId: string,
  { hasGutter, scroll = true }: { hasGutter?: boolean; scroll?: boolean } = {},
): boolean => {
  if (typeof document === 'undefined') return false;
  const selector = `[data-document-comment-id="${commentId}"]`;
  // An anchored thread with a gutter open renders in both the gutter and the
  // flat list below the document (the list is the complete record). Prefer
  // the gutter's copy — the one a body click is actually about — and only
  // fall back to the list's when there is no gutter copy to prefer.
  const card =
    document.querySelector<HTMLElement>(`[data-document-comment-gutter] ${selector}`) ??
    document.querySelector<HTMLElement>(selector);
  if (!card) return false;

  // A card in the panel is already pulled level with its run — a click there
  // must not move the viewport at all. Without a panel (e.g. AgentDocumentPage's
  // rightPanel={false}) the same click's card lives in the flat list below the
  // document, anywhere on the page; `scroll: false` only opts out of the
  // panel's redundant motion, never out of bringing an off-screen card into view.
  const inGutter = hasGutter ?? Boolean(card.closest('[data-document-comment-gutter]'));
  if (scroll || !inGutter) card.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
  if (inGutter) return true;
  card.classList.add(styles.highlighted);
  setTimeout(() => card.classList.remove(styles.highlighted), LOCATE_FLASH_DURATION);
  return true;
};

/**
 * Scroll an anchored run into view. Ranges are not elements, so the scroll
 * target is the element the run starts in — close enough to put the quote on
 * screen, and free of the layout thrash a measured scroll would cost.
 */
export const scrollAnchorIntoView = (range: Range): void => {
  const { startContainer } = range;
  const element =
    startContainer.nodeType === Node.ELEMENT_NODE
      ? (startContainer as HTMLElement)
      : startContainer.parentElement;
  element?.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
};
