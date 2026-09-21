export const CLI_CREDIT_LIMIT_PATTERNS = [
  /you'?ve reached your .{0,40}\blimit\b/i,
  /\/usage-credits\b/i,
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
