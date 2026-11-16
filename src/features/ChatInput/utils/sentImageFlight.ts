import type { UploadFileItem } from '@/types/files/upload';

import { isImageUpload } from './imageUploads';

/** Marks a composer thumbnail with its upload's key, so a send can find where it flies from. */
export const CHAT_INPUT_IMAGE_ATTR = 'data-chat-input-image';

/** More images than this fly as a crowd that reads as noise; the rest just appear. */
const MAX_FLIGHTS = 4;
/**
 * How long a thumbnail waits for its image in the sent message. The message is created
 * after the send's preflight; a send that is queued instead never renders one.
 */
const TARGET_TIMEOUT_MS = 2000;
const FLIGHT_MS = 420;
const FLIGHT_STAGGER_MS = 30;
const FLIGHT_EASING = 'cubic-bezier(0.2, 0, 0, 1)';
const FADE_MS = 160;

/** Key the composer card is rendered under: the preview URL outlives the id change on upload. */
export const getChatInputImageKey = (item: Pick<UploadFileItem, 'id' | 'previewUrl'>) =>
  item.previewUrl ?? item.id;

/** The URL the optimistic user message shows for an upload; mirrors its `imageList`. */
const getSentImageUrl = (item: UploadFileItem) =>
  item.fileUrl || item.base64Url || item.previewUrl || '';

interface Flight {
  from: DOMRect;
  ghost: HTMLImageElement;
  radius: string;
  url: string;
}

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The newest rendered image showing `url` outside the composer. The same image may appear in
 * earlier messages too; the sent one is the last in document order.
 */
const findTarget = (url: string, ghosts: Set<Element>): HTMLImageElement | undefined => {
  let found: HTMLImageElement | undefined;
  for (const img of document.querySelectorAll('img')) {
    if (ghosts.has(img) || img.hasAttribute(CHAT_INPUT_IMAGE_ATTR)) continue;
    if (img.getAttribute('src') === url) found = img;
  }
  return found;
};

const sameRect = (a: DOMRect, b: DOMRect) =>
  a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;

const fadeOut = (ghost: HTMLElement) => {
  const animation = ghost.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: FADE_MS,
    easing: 'ease-out',
  });
  animation.onfinish = () => ghost.remove();
  animation.oncancel = () => ghost.remove();
};

const fly = (flight: Flight, target: HTMLImageElement, to: DOMRect, delay: number) => {
  const { from, ghost, radius } = flight;
  const targetRadius = getComputedStyle(target).borderRadius || radius;
  // Hidden while its copy flies in, so the image is not shown twice.
  const previousVisibility = target.style.visibility;
  target.style.visibility = 'hidden';

  const finish = () => {
    target.style.visibility = previousVisibility;
    ghost.remove();
  };
  // Left/top/width/height rather than a transform: the thumbnail is a square crop and the
  // message image keeps its aspect ratio, so scaling would stretch it; `object-fit: cover`
  // re-crops at every frame instead.
  const animation = ghost.animate(
    [
      {
        borderRadius: radius,
        height: `${from.height}px`,
        left: `${from.left}px`,
        top: `${from.top}px`,
        width: `${from.width}px`,
      },
      {
        borderRadius: targetRadius,
        height: `${to.height}px`,
        left: `${to.left}px`,
        top: `${to.top}px`,
        width: `${to.width}px`,
      },
    ],
    { delay, duration: FLIGHT_MS, easing: FLIGHT_EASING, fill: 'both' },
  );
  animation.onfinish = finish;
  animation.oncancel = finish;
};

const createGhost = (source: HTMLImageElement, rect: DOMRect, radius: string) => {
  const ghost = source.cloneNode() as HTMLImageElement;
  ghost.removeAttribute(CHAT_INPUT_IMAGE_ATTR);
  ghost.removeAttribute('class');
  ghost.alt = '';
  ghost.setAttribute('aria-hidden', 'true');
  Object.assign(ghost.style, {
    borderRadius: radius,
    height: `${rect.height}px`,
    left: `${rect.left}px`,
    margin: '0',
    objectFit: 'cover',
    pointerEvents: 'none',
    position: 'fixed',
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    zIndex: '2000',
  });
  document.body.append(ghost);
  return ghost;
};

/**
 * Flies the sent images from the composer into the sent message: each composer thumbnail is
 * copied in place, waits there until the message renders its image, then moves onto it.
 *
 * The composer clears right after this is called, but the user message is created later,
 * after the send's preflight awaits (and, for a new topic, a route change), so the copies
 * hold the thumbnails' place in the meantime. A copy whose image never renders, e.g. a send
 * that was queued, fades out. Call it before the composer clears, while the thumbnails are
 * still laid out.
 */
export const flySentImages = (files: UploadFileItem[]): void => {
  if (typeof document === 'undefined' || prefersReducedMotion()) return;

  const flights: Flight[] = [];
  for (const item of files.filter(isImageUpload).slice(0, MAX_FLIGHTS)) {
    const url = getSentImageUrl(item);
    const source = document.querySelector<HTMLImageElement>(
      `img[${CHAT_INPUT_IMAGE_ATTR}="${CSS.escape(getChatInputImageKey(item))}"]`,
    );
    if (!url || !source) continue;
    const from = source.getBoundingClientRect();
    if (from.width === 0 || from.height === 0) continue;
    const radius = getComputedStyle(source.parentElement ?? source).borderRadius;
    flights.push({ from, ghost: createGhost(source, from, radius), radius, url });
  }
  if (flights.length === 0) return;

  const ghosts = new Set<Element>(flights.map((flight) => flight.ghost));
  const lastRects = new Map<Flight, DOMRect>();
  const pending = new Set(flights);
  const startedAt = performance.now();
  let launched = 0;

  const tick = () => {
    for (const flight of pending) {
      const target = findTarget(flight.url, ghosts);
      const rect = target?.getBoundingClientRect();
      if (!target || !rect || rect.width === 0 || rect.height === 0) continue;

      // Launch once the target holds still for a frame: the list scrolls to the new message
      // and images settle their size as they load.
      const last = lastRects.get(flight);
      lastRects.set(flight, rect);
      if (!last || !sameRect(last, rect)) continue;

      pending.delete(flight);
      fly(flight, target, rect, launched * FLIGHT_STAGGER_MS);
      launched += 1;
    }

    if (pending.size === 0) return;
    if (performance.now() - startedAt > TARGET_TIMEOUT_MS) {
      for (const flight of pending) fadeOut(flight.ghost);
      return;
    }
    requestAnimationFrame(tick);
  };

  requestAnimationFrame(tick);
};
