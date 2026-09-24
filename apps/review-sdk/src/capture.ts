import { snapdom } from '@zumer/snapdom';

/** The toolbar's own host element carries this attribute: never picked, never captured. */
export const HOST_ATTRIBUTE = 'data-lobehub-review';

const MAX_ERRORS = 20;
const errors: string[] = [];
let installed = false;

const remember = (message: string) => {
  errors.push(`${new Date().toISOString().slice(11, 19)} ${message}`.slice(0, 1000));
  if (errors.length > MAX_ERRORS) errors.shift();
};

/** Start collecting front-end errors so a remark can say what the page itself reported. */
export function installErrorCapture() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (event) => remember(event.message || String(event.error)));
  window.addEventListener('unhandledrejection', (event) =>
    remember(
      `Unhandled rejection: ${event.reason instanceof Error ? event.reason.message : String(event.reason)}`,
    ),
  );
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    remember(
      args
        .map((arg) => {
          if (arg instanceof Error) return arg.message;
          if (typeof arg === 'string') return arg;
          try {
            return JSON.stringify(arg);
          } catch {
            return String(arg);
          }
        })
        .join(' '),
    );
    original(...args);
  };
}

export const recentErrors = (limit = 5) => errors.slice(-limit);

const MAX_WIDTH = 1600;
const EXCLUDE = [`[${HOST_ATTRIBUTE}]`];

/** The nearest ancestor that is actually scrolled — consoles often scroll a <main>, not the page. */
function scrolledAncestor(element: Element): HTMLElement | null {
  for (
    let node = element.parentElement;
    node && node !== document.body;
    node = node.parentElement
  ) {
    const { overflowY } = getComputedStyle(node);
    if (
      /auto|scroll/.test(overflowY) &&
      node.scrollHeight > node.clientHeight &&
      node.scrollTop > 0
    )
      return node;
  }
  return null;
}

/**
 * What the reviewer sees: the viewport, without the toolbar, with the picked
 * element framed. A DOM re-render loses inner scroll offsets, so a scrolled
 * container is captured on its own at full height and its visible slice is
 * pasted back where it sits. Returns null when capture fails — the remark is
 * still worth sending as text.
 */
export async function captureViewport(target: Element): Promise<string | null> {
  try {
    const rect = target.getBoundingClientRect();
    const { innerWidth: width, innerHeight: height, scrollX, scrollY } = window;
    const scale = Math.min(window.devicePixelRatio || 1, MAX_WIDTH / width, 1.5);

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext('2d');
    if (!context) return null;

    const page = await snapdom.toCanvas(document.body, { exclude: EXCLUDE, scale });
    context.drawImage(
      page,
      scrollX * scale,
      scrollY * scale,
      canvas.width,
      canvas.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );

    const scroller = scrolledAncestor(target);
    if (scroller) {
      const box = scroller.getBoundingClientRect();
      const { clientHeight, clientWidth, scrollTop } = scroller;
      const full = await snapdom.toCanvas(scroller, { exclude: EXCLUDE, scale });
      // Only paste when the capture really is the full content; otherwise the
      // page capture above is the better of two imperfect pictures.
      if (full.height >= (scrollTop + clientHeight) * scale * 0.98)
        context.drawImage(
          full,
          0,
          scrollTop * scale,
          clientWidth * scale,
          clientHeight * scale,
          box.left * scale,
          box.top * scale,
          clientWidth * scale,
          clientHeight * scale,
        );
    }

    const pad = 4 * scale;
    context.lineWidth = 3 * scale;
    context.strokeStyle = '#f5222d';
    context.strokeRect(
      rect.left * scale - pad,
      rect.top * scale - pad,
      rect.width * scale + pad * 2,
      rect.height * scale + pad * 2,
    );
    return canvas.toDataURL('image/jpeg', 0.82);
  } catch (error) {
    console.warn('[lobehub-review] screenshot failed', error);
    return null;
  }
}
