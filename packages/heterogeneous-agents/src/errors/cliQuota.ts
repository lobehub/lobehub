/**
 * Quota wording shared by CLI-wrapped agents.
 *
 * Every local CLI agent bills against its own subscription and prints the
 * same kind of sentence when that subscription is spent — CC's `You've hit
 * your weekly limit`, Kimi Code's `You've reached your weekly (7-day) usage
 * limit`, a gateway's `已达到 5 小时使用上限`. The patterns therefore live here
 * rather than in one adapter, and `classifyCliQuotaMessage` is the single
 * place that turns them into a taxonomy kind.
 */

/** Remedies that only a top-up clears — waiting for a window never helps. */
const CLI_CREDIT_REMEDY_PATTERNS = [/\/usage-credits\b/i] as const;

export const CLI_CREDIT_LIMIT_PATTERNS = [
  /you'?ve reached your .{0,40}\blimit\b/i,
  ...CLI_CREDIT_REMEDY_PATTERNS,
] as const;

export const CLI_USER_RATE_LIMIT_PATTERNS = [
  /you'?ve hit your limit/i,
  // CC names the window in the wording it actually ships — `You've hit your
  // session limit · resets 6:30pm (Asia/Shanghai)` and `You've hit your weekly
  // limit · resets Jul 3 at 1pm`. Without these the bare `you've hit your
  // limit` pattern misses every real message, leaving the 429 to fall through
  // to the overloaded (retry) guide.
  /you'?ve hit your \S+ limit/i,
  ...CLI_CREDIT_LIMIT_PATTERNS,
  /usage limit reached/i,
  /\blimit reached\b/i,
  // Gateways/proxies in front of the API localize the same quota rejection,
  // e.g. `API Error: Request rejected (429) · [1234][已达到 5 小时使用上限，
  // 2026-06-19 22:00:00 后可继续使用。…]`. English-only patterns classified
  // these as a transient overload and told the user to just retry.
  /使用上限/,
] as const;

/**
 * Anthropic's server-side transient throttle. CC surfaces this as a 429 with
 * a message that explicitly disclaims the user's plan limit ("not your usage
 * limit") — e.g. `API Error: Server is temporarily limiting requests (not your
 * usage limit) · Rate limited`. It clears on its own in moments, so it must be
 * classified as `overloaded` (retry UX), NOT `rate_limit` (which renders a
 * misleading "usage limit reached" reset-time guide).
 */
export const CLI_SERVER_THROTTLE_PATTERNS = [
  /not your usage limit/i,
  /server is temporarily limiting requests/i,
] as const;

/**
 * Wording that promises the window reopens by itself — Kimi Code's
 * `Your quota will reset when the current 7-day window ends`, CC's
 * `resets 6:30pm (Asia/Shanghai)`, a gateway's `2026-06-19 22:00:00 后可继续
 * 使用`. It is what separates a plan window (wait, or schedule the
 * continuation) from exhausted credits (top up or switch model), because both
 * open with the same "you've reached your … limit" sentence.
 */
const CLI_QUOTA_RESET_PATTERNS = [
  // The verb alone is the signal: a message that already qualified as a
  // user-quota rejection only says "reset" / "refresh" about its own window.
  /\bresets?\b/i,
  /\b(?:refresh|renew)(?:ed|es|s)?\b/i,
  /后可继续使用/,
  /(?:额度|配额|上限)[^。]{0,12}(?:重置|刷新|恢复)/,
] as const;

/**
 * The window a rejected quota belongs to, in the vocabulary the rate-limit
 * guide already renders (`seven_day` → 周期上限, `five_hour` → 5 小时上限).
 * CC ships it as structured `rate_limit_info`; CLIs that only print prose
 * (Kimi Code: `You've reached your weekly (7-day) usage limit`) get it read
 * back out of the sentence so the card can name the window.
 */
const CLI_RATE_LIMIT_TYPE_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/\bweekly\b|\b7[\s-]?day\b|\bseven[\s-]?day\b|每周|7\s*天|七天/i, 'seven_day'],
  [/\b5[\s-]?hour\b|\bfive[\s-]?hour\b|\bsession limit\b|5\s*小时/i, 'five_hour'],
] as const;

export interface CliQuotaClassification {
  /** `usage_limit` resets on its own; `credit_limit` needs a top-up. */
  kind: 'credit_limit' | 'usage_limit';
  /** Window name for the guide card, when the message states one. */
  rateLimitType?: string;
}

/**
 * Classify a CLI's free-form failure text as a user-side quota rejection.
 *
 * Deliberately agent-agnostic: every CLI-wrapped agent bills against its own
 * subscription and prints the same kind of sentence when that subscription is
 * spent, so the classification lives with the patterns rather than in one
 * adapter. Returns `undefined` for anything that is not unambiguously the
 * user's own quota — a bare 429, `rate limited`, or a provider-side throttle
 * that disclaims the plan limit belongs to the retry (overloaded) path.
 */
export const classifyCliQuotaMessage = (
  message: string | undefined,
): CliQuotaClassification | undefined => {
  if (!message) return;
  if (CLI_SERVER_THROTTLE_PATTERNS.some((pattern) => pattern.test(message))) return;
  if (!CLI_USER_RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(message))) return;

  // A message that names both a top-up remedy and a reset is still a window:
  // waiting clears it, which is the remedy the guide offers first.
  const resets = CLI_QUOTA_RESET_PATTERNS.some((pattern) => pattern.test(message));
  const kind =
    CLI_CREDIT_REMEDY_PATTERNS.some((pattern) => pattern.test(message)) ||
    (!resets && CLI_CREDIT_LIMIT_PATTERNS.some((pattern) => pattern.test(message)))
      ? 'credit_limit'
      : 'usage_limit';
  const rateLimitType = CLI_RATE_LIMIT_TYPE_PATTERNS.find(([pattern]) =>
    pattern.test(message),
  )?.[1];

  return { kind, ...(rateLimitType ? { rateLimitType } : {}) };
};
