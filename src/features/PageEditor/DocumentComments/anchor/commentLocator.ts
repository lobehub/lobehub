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
 * `scroll` is opt-in because the two callers want different things: a deep
 * link has to bring the card into view, while a click in the body must not
 * move the reader's viewport at all.
 */
export const focusCommentCard = (commentId: string, { scroll = true } = {}): boolean => {
  if (typeof document === 'undefined') return false;
  const card = document.querySelector<HTMLElement>(`[data-document-comment-id="${commentId}"]`);
  if (!card) return false;

  if (scroll) card.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
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
