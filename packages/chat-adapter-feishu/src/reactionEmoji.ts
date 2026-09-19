/**
 * Feishu/Lark reactions are a **named enum**, not unicode.
 *
 * `POST /im/v1/messages/{id}/reactions` takes `reaction_type.emoji_type`
 * values like `OK` / `MUSCLE` / `FIRE` and rejects anything else with
 * `231001 reaction type is invalid`. Every other platform we support takes
 * unicode, so callers speak unicode — this module is the single translation
 * point between them. Without it every reaction on Feishu/Lark fails, and
 * because both call sites swallow reaction errors the only symptom is that the
 * bot never appears to acknowledge anything.
 *
 * It lives in the adapter package, next to `LarkApiClient`, for the same reason
 * `decodeLarkThreadId` does: `LarkAdapter` and the server-side bot platform
 * client both need it, and two copies of an enum this fiddly would drift.
 *
 * Only enum names taken from Feishu's published emoji list appear here (the
 * `常用值` table in `protocol-spec.md` §5.1, plus the full list it links to at
 * https://open.feishu.cn/document/server-docs/im-v1/message-reaction/emojis-introduce).
 * Do NOT add a value guessed from Feishu's UI — an undocumented `emoji_type` is
 * just another `231001`. The casing is Feishu's own and is inconsistent on
 * purpose (`THUMBSUP` but `ThumbsDown`, `OnIt`, `CheckMark`, `Trophy`).
 */
const FEISHU_EMOJI_TYPES = [
  // 正面 / 认可
  'OK',
  'THUMBSUP',
  'THANKS',
  'MUSCLE',
  'APPLAUSE',
  'FISTBUMP',
  'JIAYI',
  'DONE',
  'LGTM',
  // 笑脸
  'SMILE',
  'LAUGH',
  'LOL',
  'LOVE',
  'WINK',
  'JOYFUL',
  'WOW',
  'YEAH',
  // 悲伤
  'SOB',
  'CRY',
  'FROWN',
  'SPEECHLESS',
  // 手势
  'ThumbsDown',
  'HIGHFIVE',
  'WAVE',
  'SALUTE',
  // 物品
  'HEART',
  'ROSE',
  'FIRE',
  'PARTY',
  'BEER',
  'CAKE',
  'GIFT',
  'Trophy',
  // 进行中 — the states the bot bridge cycles through
  'OnIt',
  'THINKING',
  'Typing',
  'OneSecond',
  // 符号
  'POOP',
  'HEARTBROKEN',
  'CheckMark',
  'CrossMark',
  'Hundred',
] as const;

/** Lower-cased enum name → the exact-cased value Feishu expects. */
const CANONICAL_BY_LOWERCASE = new Map(
  FEISHU_EMOJI_TYPES.map((name) => [name.toLowerCase(), name]),
);

/**
 * Unicode → Feishu `emoji_type`.
 *
 * The first three entries are what the bot bridge actually sends on every run
 * (`RECEIVED_REACTION_EMOJI` / `THINKING_REACTION_EMOJI` /
 * `WORKING_REACTION_EMOJI` in `../const.ts`) — keep them mapped or the
 * progress reactions go dark again. The rest cover what an agent plausibly
 * passes to the `reactToMessage` tool, whose schema asks for unicode.
 */
const EMOJI_TYPE_BY_UNICODE: Record<string, (typeof FEISHU_EMOJI_TYPES)[number]> = {
  '❤': 'HEART',
  '❤️': 'HEART',
  '⚡': 'OnIt', // bridge: a tool call is running — 「处理中」
  '✅': 'CheckMark',
  '❌': 'CrossMark',
  '🌹': 'ROSE',
  '🎁': 'GIFT',
  '🎂': 'CAKE',
  '🎉': 'PARTY',
  '🍺': 'BEER',
  '👀': 'OK', // bridge: the bot has picked the message up — 「好的」
  '👋': 'WAVE',
  '👌': 'OK',
  '👍': 'THUMBSUP',
  '👎': 'ThumbsDown',
  '👏': 'APPLAUSE',
  '👊': 'FISTBUMP',
  '💔': 'HEARTBROKEN',
  '💩': 'POOP',
  '💪': 'MUSCLE',
  '💯': 'Hundred',
  '🔥': 'FIRE',
  '🙁': 'FROWN',
  '🙌': 'HIGHFIVE',
  '🙏': 'THANKS',
  '🤔': 'THINKING', // bridge: the agent is reasoning — 「思考」
  '🤣': 'LOL',
  '🥳': 'PARTY',
  '🫡': 'SALUTE',
  '😀': 'SMILE',
  '😂': 'LOL',
  '😄': 'SMILE',
  '😆': 'LAUGH',
  '😊': 'SMILE',
  '😉': 'WINK',
  '😍': 'LOVE',
  '😮': 'WOW',
  '😲': 'WOW',
  '😶': 'SPEECHLESS',
  '😢': 'CRY',
  '😭': 'SOB',
  '🆗': 'OK',
};

/**
 * Resolve a Feishu/Lark `emoji_type` from what a caller supplied.
 *
 * Accepts either a unicode emoji (what the bridge and the tool schema use) or
 * an `emoji_type` name the caller already knows, in any casing. Returns
 * `undefined` when there is no documented equivalent — callers decide what
 * that means for them, but nobody may pass the raw input through: doing so is
 * a guaranteed `231001`.
 */
export const toFeishuEmojiType = (emoji: string | null | undefined): string | undefined => {
  if (!emoji) return undefined;
  const trimmed = emoji.trim();
  if (!trimmed) return undefined;
  return EMOJI_TYPE_BY_UNICODE[trimmed] ?? CANONICAL_BY_LOWERCASE.get(trimmed.toLowerCase());
};

/** Every `emoji_type` this module can produce, for error messages. */
export const supportedFeishuEmojiTypes = (): string[] => [...FEISHU_EMOJI_TYPES];
