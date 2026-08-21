/** Default debounce window (ms) for message batching. */
export const DEFAULT_BOT_DEBOUNCE_MS = 2000;

/** Maximum debounce window (ms) allowed across all platforms. */
export const MAX_BOT_DEBOUNCE_MS = 30_000;

/** Default number of messages to read from channel history. */
export const DEFAULT_BOT_HISTORY_LIMIT = 50;

/**
 * Maximum number of messages allowed at the interface layer.
 * This is the upper bound across all platforms (Slack supports up to 999).
 * Each platform service clamps to its own API limit.
 */
export const MAX_BOT_HISTORY_LIMIT = 999;

/** Minimum number of messages allowed for history limit. */
export const MIN_BOT_HISTORY_LIMIT = 1;

/**
 * Per-platform attachment size budgets for the proactive messenger push path.
 *
 * Shared between the server (which enforces them: over-budget images are
 * recompressed, files that cannot fit degrade to a download-link message —
 * see apps/server/src/services/bot/platforms/attachmentBudget.ts) and the
 * client (which uses them to warn the user in the push modal BEFORE sending).
 *
 * Values are deliberately conservative:
 * - telegram: 5MB photo / 20MB file — Bot API caps for URL-sourced media.
 * - discord: 10MB — default upload cap for bots (DMs never get guild boosts).
 * - slack: 50MB — `files.upload` v2 itself allows 1GB, but every sender
 *   materializes the file in memory to upload it, so the real ceiling is
 *   MAX_IN_MEMORY_ATTACHMENT_BYTES. Budgeting at 1GB made the 50MB–1GB band
 *   pass the budget pass as an upload and then fail during materialization,
 *   dropping the attachment with neither a file nor a download link.
 * - wechat: 2MB image — empirical: iLink silently drops larger images
 *   (every API call returns 200 yet the message never renders); 20MB file
 *   as a best-effort cap, the iLink protocol documents no explicit number.
 *
 * `textMaxChars` is the single-message character cap used to batch the
 * download-link fallbacks: Discord rejects a message over 2000 chars,
 * Telegram truncates at 4096 (which would cut a URL in half), Slack's
 * practical `chat.postMessage` limit is ~3000, and iLink documents none —
 * so WeChat reuses Discord's conservative number.
 */
export interface MessengerAttachmentBudget {
  fileMaxBytes: number;
  imageMaxBytes: number;
  /**
   * Character cap for a single outbound text message. Used to batch
   * download-link fallbacks: a message over the cap is either rejected
   * (Discord) or truncated mid-URL (Telegram), both of which lose the link.
   */
  textMaxChars: number;
}

const MB = 1024 * 1024;

export const MESSENGER_ATTACHMENT_BUDGETS: Record<
  'discord' | 'slack' | 'telegram' | 'wechat',
  MessengerAttachmentBudget
> = {
  discord: { fileMaxBytes: 10 * MB, imageMaxBytes: 10 * MB, textMaxChars: 2000 },
  slack: { fileMaxBytes: 50 * MB, imageMaxBytes: 50 * MB, textMaxChars: 3000 },
  telegram: { fileMaxBytes: 20 * MB, imageMaxBytes: 5 * MB, textMaxChars: 4096 },
  wechat: { fileMaxBytes: 20 * MB, imageMaxBytes: 2 * MB, textMaxChars: 2000 },
};
