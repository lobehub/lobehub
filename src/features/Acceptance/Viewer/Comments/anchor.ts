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

/**
 * The link to hand someone else — this page, this comment. `appOrigin` comes
 * from `useAppOrigin`, not `window.location`: on desktop that is the
 * `app://renderer` shell, which nobody else can open.
 */
export const commentAnchorUrl = (commentId: string, appOrigin: string) => {
  if (typeof window === 'undefined') return '';
  const { pathname, search } = window.location;
  // A shared link must open for anyone the report is public to, and the
  // workspace-prefixed route only mounts for members — drop the slug.
  const publicPath = pathname.replace(/^\/[^/]+(?=\/acceptance\/)/, '');
  return `${appOrigin}${publicPath}${search}#${commentAnchorId(commentId)}`;
};

/** How long a linked comment is held in view while the evidence above it loads. */
const SETTLE_MS = 4000;
const READER_INPUT = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;

/**
 * Keep a linked comment centred while the page above it settles.
 *
 * The first scroll lands before the screenshots and recordings above the
 * comment know their size; as they load they push it far below the fold. Each
 * time the scrolling content grows the comment is centred again, until the
 * content settles or the reader scrolls on their own — which always wins.
 * Returns the release.
 */
export const holdInView = (element: HTMLElement, duration = SETTLE_MS) => {
  let scroller = element.parentElement;
  while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY))
    scroller = scroller.parentElement;
  const observer = new ResizeObserver(() => element.scrollIntoView({ block: 'center' }));
  for (const child of (scroller ?? document.body).children) observer.observe(child);
  const release = () => {
    observer.disconnect();
    clearTimeout(timer);
    for (const type of READER_INPUT) window.removeEventListener(type, release, true);
  };
  const timer = setTimeout(release, duration);
  for (const type of READER_INPUT)
    window.addEventListener(type, release, { capture: true, passive: true });
  return release;
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
  const release = useRef<() => void>(undefined);

  useEffect(() => {
    if (!anchoredId || scrolledTo.current === anchoredId) return;
    const element = document.getElementById(commentAnchorId(anchoredId));
    if (!element) return;
    scrolledTo.current = anchoredId;
    release.current?.();
    element.scrollIntoView({ block: 'center' });
    release.current = holdInView(element);
  }, [anchoredId, ready]);
  useEffect(() => () => release.current?.(), []);

  return anchoredId;
};
