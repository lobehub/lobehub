/**
 * Single-owner arbiter for page-level "pending interaction" hotkeys.
 *
 * Several pending-interaction cards can be mounted at once — e.g. the active
 * conversation's AskUserQuestion / tool-approval card plus the global approval
 * notification surfacing another conversation's card. If each installed its
 * own `window` keydown listener, one keystroke could drive several cards, and
 * which card saw it first would follow window listener registration order —
 * which silently reshuffles whenever any card's effect re-registers.
 *
 * Instead the arbiter owns the ONE window listener and dispatches each
 * keypress to exactly one card:
 *   1. the card containing the event target (focus/containment wins), else
 *   2. the most recently registered card.
 *
 * Registration order only matters as the fallback, and is stable as long as
 * cards register once per mount.
 */
export interface PendingHotkeyCard {
  /** Whether the node lives inside this card (root or portaled footer). */
  contains: (node: Node) => boolean;
  /** Handle a keypress this card owns; apply per-card guards inside. */
  onKeyDown: (event: KeyboardEvent) => void;
}

const cards: PendingHotkeyCard[] = [];

const dispatch = (event: KeyboardEvent) => {
  const target = event.target as Node | null;
  const owner = (target && cards.find((card) => card.contains(target))) ?? cards.at(-1);
  owner?.onKeyDown(event);
};

/**
 * Register a card for its mount lifetime; returns the unregister cleanup.
 * The shared window listener exists only while at least one card is mounted.
 */
export const registerPendingHotkeyCard = (card: PendingHotkeyCard): (() => void) => {
  if (cards.length === 0) window.addEventListener('keydown', dispatch);
  cards.push(card);
  return () => {
    const idx = cards.indexOf(card);
    if (idx >= 0) cards.splice(idx, 1);
    if (cards.length === 0) window.removeEventListener('keydown', dispatch);
  };
};
