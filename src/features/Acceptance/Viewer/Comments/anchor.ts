import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';

/**
 * A comment is addressable, the way a pull-request comment is: its id lives in
 * the URL fragment, so a link pasted into chat opens the acceptance already
 * scrolled to the remark it is about. The fragment is used rather than a query
 * parameter so it never collides with the round and filter params the page
 * already carries, and so the browser keeps it across in-page navigation.
 */
const PREFIX = 'comment-';

export const commentAnchorId = (commentId: string) => `${PREFIX}${commentId}`;

/** The comment a fragment addresses, or undefined for any other fragment. */
export const commentIdFromHash = (hash: string): string | undefined => {
  const value = hash.replace(/^#/, '');
  return value.startsWith(PREFIX) ? value.slice(PREFIX.length) || undefined : undefined;
};

/** The link to hand someone else — this page, this comment. */
export const commentAnchorUrl = (commentId: string) => {
  if (typeof window === 'undefined') return '';
  const { origin, pathname, search } = window.location;
  return `${origin}${pathname}${search}#${commentAnchorId(commentId)}`;
};

/**
 * Which comment the URL points at, and a one-shot scroll to it.
 *
 * The scroll waits for the comment to exist: the list is fetched, so on a cold
 * open the element is not in the document when the fragment is first read.
 * `ready` is whatever the caller knows changes when the list arrives.
 *
 * Embedded viewers (a portal beside a conversation) share the page's fragment
 * with whatever else is mounted, so they never claim it.
 */
export const useCommentAnchor = (ready: unknown, embedded = false) => {
  const { hash } = useLocation();
  const anchoredId = embedded ? undefined : commentIdFromHash(hash);
  const scrolledTo = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!anchoredId || scrolledTo.current === anchoredId) return;
    const element = document.getElementById(commentAnchorId(anchoredId));
    if (!element) return;
    scrolledTo.current = anchoredId;
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [anchoredId, ready]);

  return anchoredId;
};
