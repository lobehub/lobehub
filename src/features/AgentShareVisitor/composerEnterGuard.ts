/**
 * Decide whether a keyboard `Enter` press should submit the visitor composer.
 *
 * Extracted so the IME-composition guard is unit-testable without rendering
 * `VisitorComposer` — see `composerEnterGuard.test.ts`.
 *
 * rc-textarea's `onPressEnter` (which `@lobehub/ui`'s `TextArea` forwards)
 * fires on every `Enter` keydown with NO built-in IME-composing check — so an
 * Enter that only confirms an IME candidate (e.g. picking a Chinese/Japanese
 * character) would otherwise submit the partial composition text.
 */
export const shouldSubmitOnEnter = (event: { shiftKey: boolean }, isComposing: boolean): boolean =>
  !event.shiftKey && !isComposing;
