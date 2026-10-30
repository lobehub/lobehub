/** How long one gesture keeps the page's transient user activation (Chrome and Firefox: 5 s). */
export const ACTIVATION_WINDOW_MS = 5000;

const HOST_GESTURES = ['keydown', 'pointerdown', 'pointerup'] as const;

/**
 * Tells whether the user just acted inside one view. A click or key press in
 * the sandboxed iframe never reaches the host as an event. The host only sees
 * that the page has transient activation and that focus is in the frame, and
 * neither proves a gesture in the view: a view can focus itself, and the
 * activation may come from the host's own UI, such as the click that opened
 * the topic. So the host also requires that it saw no gesture of its own for
 * as long as an activation lasts, counting from when the gate was created.
 *
 * One gesture covers one message. The host can't tell two clicks in the view
 * apart, so once a gesture has been used, the activation that is live then
 * counts as spent, and a gesture counts again only after it would have expired.
 */
export const createViewGestureGate = (now: () => number = () => performance.now()) => {
  // When the live activation last stopped counting as the view's: a host
  // gesture, or a message already sent on it. Host gestures from before the
  // gate existed went unseen, so assume one just happened.
  let unusableSince = now();
  const markUnusable = () => {
    unusableSince = now();
  };
  for (const type of HOST_GESTURES) window.addEventListener(type, markUnusable, true);

  return {
    dispose: () => {
      for (const type of HOST_GESTURES) window.removeEventListener(type, markUnusable, true);
    },
    /** Whether the user just acted in this view. A true answer uses the gesture up. */
    takeGestureIn: (iframe: HTMLIFrameElement) => {
      const fromUser =
        document.activeElement === iframe &&
        navigator.userActivation?.isActive === true &&
        now() - unusableSince >= ACTIVATION_WINDOW_MS;
      if (fromUser) markUnusable();

      return fromUser;
    },
  };
};
