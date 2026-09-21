import { isDesktop } from '@/const/version';
import { electronSystemService } from '@/services/electron/system';

// The renderer is the final gate before the OS handler — the desktop main
// process hands URLs straight to shell.openExternal, so only http(s) may pass.
const OPENABLE_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Open a URL the caller vouches for in the OS browser (desktop) or a new
 * browser tab (web).
 *
 * Contract: callers pass only URLs from first-party data — our API responses,
 * git service results, or constants — never raw user input or parsed
 * terminal/markdown output unless that content has been vetted upstream.
 * The helper is the last line of defense regardless of the caller: http(s)
 * only, never navigates the current window, and the new tab is detached with
 * noopener/noreferrer so the opened page cannot reach back.
 */
export const openTrustedExternalUrl = (rawUrl: string): void => {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return;
  }

  if (!OPENABLE_PROTOCOLS.has(parsed.protocol)) return;

  if (isDesktop) {
    void electronSystemService.openExternalLink(parsed.href).catch(() => {});
  } else {
    // Synchronous window.open inside the click handler keeps the user gesture
    // trusted so browser popup blockers don't intervene.
    window.open(parsed.href, '_blank', 'noopener,noreferrer');
  }
};
