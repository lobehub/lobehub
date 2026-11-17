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
/** How long a landed copy covers a message image that is still downloading. */
const LOAD_TIMEOUT_MS = 5000;

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
 * The newest image showing `url` that rendered after the send started, outside the composer.
 * `ignored` holds every image on the page when the send started (plus the copies): the same
 * image may already show in an earlier message, e.g. one restored to the composer, and a
 * queued send must not fly into it.
 */
const findTarget = (url: string, ignored: Set<Element>): HTMLImageElement | undefined => {
  let found: HTMLImageElement | undefined;
  for (const img of document.querySelectorAll('img')) {
    if (ignored.has(img) || img.hasAttribute(CHAT_INPUT_IMAGE_ATTR)) continue;
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

const fly = (
  flight: Flight,
  initialTarget: HTMLImageElement,
  to: DOMRect,
  delay: number,
  ignored: Set<Element>,
) => {
  const { from, ghost, radius, url } = flight;
  const targetRadius = getComputedStyle(initialTarget).borderRadius || radius;
  let target = initialTarget;
  let previousVisibility = '';
  // Hidden while its copy flies in, so the image is not shown twice.
  const hide = (img: HTMLImageElement) => {
    previousVisibility = img.style.visibility;
    img.style.visibility = 'hidden';
  };
  hide(target);

  const reveal = () => {
    target.style.visibility = previousVisibility;
    ghost.remove();
  };
  /**
   * The list keeps moving after launch: it scrolls as the reply streams in, and a new topic
   * re-renders the whole message list once its route settles. The copy follows the target's
   * current position (as an offset, so it composes with the flight) and moves onto the
   * re-rendered image; false while no image is rendered.
   */
  const follow = () => {
    if (!target.isConnected) {
      const next = findTarget(url, ignored);
      if (!next) return false;
      target = next;
      hide(target);
    }
    const rect = target.getBoundingClientRect();
    ghost.style.translate = `${rect.left - to.left}px ${rect.top - to.top}px`;
    return true;
  };
  // The message shows the uploaded file's URL, which may still be downloading when the copy
  // lands; the copy stays on top until it has loaded, so no empty grey box shows in between.
  // `complete` is also true for a failed load, which then shows its own fallback.
  let landedAt = 0;
  const step = () => {
    const present = follow();
    if (landedAt && present && target.complete) return reveal();
    if (landedAt && performance.now() - landedAt > LOAD_TIMEOUT_MS) {
      if (present) reveal();
      else fadeOut(ghost);
      return;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  const land = () => {
    landedAt ||= performance.now();
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
  animation.onfinish = land;
  animation.oncancel = land;
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

  const ignored = new Set<Element>(document.querySelectorAll('img'));
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

  for (const flight of flights) ignored.add(flight.ghost);
  const lastRects = new Map<Flight, DOMRect>();
  const pending = new Set(flights);
  const startedAt = performance.now();
  let launched = 0;

  const tick = () => {
    for (const flight of pending) {
      const target = findTarget(flight.url, ignored);
      const rect = target?.getBoundingClientRect();
      if (!target || !rect || rect.width === 0 || rect.height === 0) continue;

      // Launch once the target holds still for a frame: the list scrolls to the new message
      // and images settle their size as they load.
      const last = lastRects.get(flight);
      lastRects.set(flight, rect);
      if (!last || !sameRect(last, rect)) continue;

      pending.delete(flight);
      fly(flight, target, rect, launched * FLIGHT_STAGGER_MS, ignored);
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
