import { HotkeyScopeEnum } from '@lobechat/const/hotkeys';
import { useEffect } from 'react';
import { useHotkeysContext } from 'react-hotkeys-hook';

import { type HotkeyId } from '@/types/hotkey';

import { useHotkeyById } from './useHotkeyById';

/** How long the first key of a sequence (`g`, `*`) waits for the second. */
const SEQUENCE_TIMEOUT_MS = 1000;
const SEQUENCE_PREFIXES = new Set(['*', 'g']);
const MODIFIER_KEYS = new Set(['Alt', 'AltGraph', 'Control', 'Meta', 'OS', 'Shift']);

/** Keys that answer the `g` / `*` before them; a bare-key hotkey must not also act on them. */
const sequenceKeys = new WeakSet<KeyboardEvent>();
let pendingPrefix: { at: number; key: string } | undefined;

const isTyping = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.matches('input, textarea, select, [role="textbox"], [role="combobox"]');
};

/**
 * A modal or an open menu handles its own keys. Matched on what is on screen,
 * not on focus: a menu opened by mouse leaves focus on the page behind it.
 */
/**
 * Layers that take the keyboard while on screen. A toast says it is a
 * non-modal dialog (`aria-modal="false"`), so it does not; a modal that leaves
 * `aria-modal` out (the hotkey help) still does.
 */
const BLOCKING_OVERLAYS =
  '[role="dialog"]:not([aria-modal="false"]), [role="alertdialog"], [role="menu"], [role="listbox"]';
const OVERLAYS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

const overlayOpen = (target: EventTarget | null) => {
  // Focus inside any layer, a toast included, leaves the keys to it.
  if (target instanceof Element && target.closest(OVERLAYS)) return true;
  // Closed popups can stay mounted, hidden; only one taking space on screen counts.
  return [...document.querySelectorAll<HTMLElement>(BLOCKING_OVERLAYS)].some(
    (element) => element.getClientRects().length > 0,
  );
};

const trackSequence = (event: KeyboardEvent) => {
  if (event.repeat || MODIFIER_KEYS.has(event.key)) return;
  if (isTyping(event.target)) {
    pendingPrefix = undefined;
    return;
  }
  const now = Date.now();
  if (pendingPrefix && now - pendingPrefix.at < SEQUENCE_TIMEOUT_MS) {
    sequenceKeys.add(event);
    pendingPrefix = undefined;
    return;
  }
  const bare = !event.metaKey && !event.ctrlKey && !event.altKey;
  pendingPrefix =
    bare && SEQUENCE_PREFIXES.has(event.key) ? { at: now, key: event.key } : undefined;
};

/**
 * Turns on the mail page's hotkeys while it is mounted. Call once, from the
 * page; every `useMailHotkey` below it stays silent otherwise.
 */
export const useRegisterMailHotkeys = () => {
  const { enableScope, disableScope } = useHotkeysContext();

  useEffect(() => {
    enableScope(HotkeyScopeEnum.Mail);
    // Capture runs before the hotkey listeners, so they can tell `g s` from `s`.
    document.addEventListener('keydown', trackSequence, true);
    return () => {
      disableScope(HotkeyScopeEnum.Mail);
      document.removeEventListener('keydown', trackSequence, true);
      pendingPrefix = undefined;
    };
  }, [enableScope, disableScope]);
};

export interface MailHotkeyOptions {
  /** Also fires from a text field: only the composer's own keys (send, save, close). */
  inFields?: boolean;
  /** Second key of a `g` / `*` sequence. */
  sequence?: boolean;
  /** Match the produced character rather than the key position, as `*` needs. */
  useKey?: boolean;
}

/**
 * One mail hotkey. The handler returns `false` when it had nothing to act on,
 * so the key keeps its default (Enter on a button, Esc for a popover).
 *
 * Skipped while typing (unless `inFields`), while an input method is composing,
 * while a modal or menu is open, and when something nearer already handled it.
 */
export const useMailHotkey = (
  id: HotkeyId,
  handler: (event: KeyboardEvent) => boolean | void,
  { inFields, sequence, useKey }: MailHotkeyOptions = {},
) =>
  useHotkeyById(
    id,
    (event) => {
      if (event.isComposing || event.defaultPrevented) return;
      if (!sequence && sequenceKeys.has(event)) return;
      if (overlayOpen(event.target)) return;
      if (handler(event) !== false) event.preventDefault();
    },
    {
      enableOnContentEditable: Boolean(inFields),
      enableOnFormTags: Boolean(inFields),
      preventDefault: false,
      scopes: [HotkeyScopeEnum.Mail],
      useKey,
    },
  );
