import type { APIEmbed, APIEmbedField } from 'discord-api-types/v10';

/**
 * Discord embed limits.
 * @see https://discord.com/developers/docs/resources/message#embed-object-embed-limits
 */
export const DISCORD_EMBED_LIMITS = {
  /** Author name */
  authorName: 256,
  /** Embed description */
  description: 4096,
  /** Field name */
  fieldName: 256,
  /** Field value */
  fieldValue: 1024,
  /** Fields per embed */
  fields: 25,
  /** Footer text */
  footerText: 2048,
  /** Embeds per message */
  perMessage: 10,
  /** Embed title */
  title: 256,
  /** Sum of title + description + field names/values + footer + author across all embeds */
  totalCharacters: 6000,
} as const;

/** Default accent colour (Discord "blurple") when the caller passes none. */
export const DISCORD_EMBED_DEFAULT_COLOR = 0x58_65_f2;

const ZERO_WIDTH_SPACE = '\u200B';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const truncate = (value: string, max: number): string => {
  if (value.length <= max) return value;
  if (max <= 1) return value.slice(0, max);
  return `${value.slice(0, max - 1)}…`;
};

const readString = (value: unknown, max: number): string | undefined => {
  if (typeof value === 'number' || typeof value === 'boolean') value = String(value);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return truncate(trimmed, max);
};

const readUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!/^(?:https?|attachment):\/\//i.test(trimmed)) return undefined;
  return trimmed;
};

/**
 * Accepts a Discord colour integer, a `#RRGGBB` / `RRGGBB` / `0xRRGGBB`
 * string, or a decimal numeric string. Returns undefined for anything else so
 * the caller can fall back to the default accent.
 */
export const parseDiscordEmbedColor = (value: unknown): number | undefined => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined;
    const int = Math.trunc(value);
    return int >= 0 && int <= 0xff_ff_ff ? int : undefined;
  }
  if (typeof value !== 'string') return undefined;
  const raw = value.trim();
  if (!raw) return undefined;
  const hex = raw.match(/^(?:#|0x)?([\dA-Fa-f]{6})$/);
  if (hex) return Number.parseInt(hex[1], 16);
  if (/^\d+$/.test(raw)) {
    const int = Number.parseInt(raw, 10);
    return int <= 0xff_ff_ff ? int : undefined;
  }
  return undefined;
};

const readTimestamp = (value: unknown): string | undefined => {
  if (value === true) return new Date().toISOString();
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

const readMedia = (value: unknown): { url: string } | undefined => {
  const url =
    typeof value === 'string' ? readUrl(value) : isRecord(value) ? readUrl(value.url) : undefined;
  return url ? { url } : undefined;
};

const readFields = (value: unknown): APIEmbedField[] => {
  if (!Array.isArray(value)) return [];
  const fields: APIEmbedField[] = [];
  for (const item of value) {
    if (fields.length >= DISCORD_EMBED_LIMITS.fields) break;
    if (!isRecord(item)) continue;
    const name = readString(item.name ?? item.label ?? item.title, DISCORD_EMBED_LIMITS.fieldName);
    const fieldValue = readString(item.value, DISCORD_EMBED_LIMITS.fieldValue);
    // Discord rejects empty field names/values — fall back to a zero-width
    // placeholder so a partially-filled field still renders.
    if (!name && !fieldValue) continue;
    const field: APIEmbedField = {
      name: name ?? ZERO_WIDTH_SPACE,
      value: fieldValue ?? ZERO_WIDTH_SPACE,
    };
    if (typeof item.inline === 'boolean') field.inline = item.inline;
    fields.push(field);
  }
  return fields;
};

const embedCharacterCount = (embed: APIEmbed): number =>
  (embed.title?.length ?? 0) +
  (embed.description?.length ?? 0) +
  (embed.footer?.text.length ?? 0) +
  (embed.author?.name.length ?? 0) +
  (embed.fields ?? []).reduce((sum, f) => sum + f.name.length + f.value.length, 0);

/**
 * Coerce a single loosely-typed embed (as produced by an LLM tool call) into a
 * Discord `APIEmbed`. Unknown keys are dropped, strings are trimmed to
 * Discord's per-field caps, and `color` accepts hex strings. Returns undefined
 * when nothing renderable is left so the caller can skip it instead of
 * letting Discord reject the whole message with a 400.
 */
export const normalizeDiscordEmbed = (input: unknown): APIEmbed | undefined => {
  if (!isRecord(input)) return undefined;

  const embed: APIEmbed = {};

  const title = readString(input.title, DISCORD_EMBED_LIMITS.title);
  if (title) embed.title = title;

  const description = readString(
    input.description ?? input.text ?? input.content,
    DISCORD_EMBED_LIMITS.description,
  );
  if (description) embed.description = description;

  const url = readUrl(input.url);
  if (url) embed.url = url;

  const timestamp = readTimestamp(input.timestamp);
  if (timestamp) embed.timestamp = timestamp;

  const footerInput = isRecord(input.footer) ? input.footer : { text: input.footer };
  const footerText = readString(footerInput.text, DISCORD_EMBED_LIMITS.footerText);
  if (footerText) {
    embed.footer = { text: footerText };
    const iconUrl = readUrl(footerInput.icon_url ?? footerInput.iconUrl);
    if (iconUrl) embed.footer.icon_url = iconUrl;
  }

  const authorInput = isRecord(input.author) ? input.author : { name: input.author };
  const authorName = readString(authorInput.name, DISCORD_EMBED_LIMITS.authorName);
  if (authorName) {
    embed.author = { name: authorName };
    const authorUrl = readUrl(authorInput.url);
    if (authorUrl) embed.author.url = authorUrl;
    const iconUrl = readUrl(authorInput.icon_url ?? authorInput.iconUrl);
    if (iconUrl) embed.author.icon_url = iconUrl;
  }

  const image = readMedia(input.image ?? input.imageUrl);
  if (image) embed.image = image;

  const thumbnail = readMedia(input.thumbnail ?? input.thumbnailUrl);
  if (thumbnail) embed.thumbnail = thumbnail;

  const fields = readFields(input.fields);
  if (fields.length > 0) embed.fields = fields;

  // An embed with only a colour / url / timestamp renders as an empty box on
  // Discord, so require at least one visible text or media block.
  const hasContent =
    !!embed.title ||
    !!embed.description ||
    !!embed.footer ||
    !!embed.author ||
    !!embed.image ||
    !!embed.thumbnail ||
    !!embed.fields;
  if (!hasContent) return undefined;

  embed.color = parseDiscordEmbedColor(input.color ?? input.colour) ?? DISCORD_EMBED_DEFAULT_COLOR;

  return embed;
};

/**
 * Shrink one embed until it fits the remaining character budget: drop trailing
 * fields first (the least important part of a report card), then cut the
 * description. Returns undefined when even the title/footer/author alone
 * exceed the budget.
 */
const fitEmbedToBudget = (embed: APIEmbed, budget: number): APIEmbed | undefined => {
  if (embedCharacterCount(embed) <= budget) return embed;

  const fitted: APIEmbed = { ...embed, fields: embed.fields ? [...embed.fields] : undefined };
  while (fitted.fields && fitted.fields.length > 0 && embedCharacterCount(fitted) > budget) {
    fitted.fields.pop();
  }
  if (fitted.fields && fitted.fields.length === 0) delete fitted.fields;

  if (embedCharacterCount(fitted) > budget && fitted.description) {
    const overflow = embedCharacterCount(fitted) - budget;
    const room = fitted.description.length - overflow;
    if (room > 0) {
      fitted.description = truncate(fitted.description, room);
    } else {
      delete fitted.description;
    }
  }

  if (embedCharacterCount(fitted) > budget) return undefined;

  const hasContent =
    !!fitted.title ||
    !!fitted.description ||
    !!fitted.footer ||
    !!fitted.author ||
    !!fitted.image ||
    !!fitted.thumbnail ||
    !!fitted.fields;
  return hasContent ? fitted : undefined;
};

/**
 * Normalize a list of tool-supplied embeds for one Discord message: drops
 * invalid entries, caps the list at 10 embeds, and enforces the 6000-character
 * budget shared by all embeds in a single message. An embed that would
 * overflow the budget is shrunk (trailing fields, then description) rather
 * than sent as-is, since Discord rejects the whole request otherwise; embeds
 * that cannot be shrunk to fit are dropped.
 *
 * Returns undefined when nothing survives so callers can spread the result
 * into the request body without emitting `embeds: []`.
 */
export const normalizeDiscordEmbeds = (input: unknown): APIEmbed[] | undefined => {
  if (!Array.isArray(input) || input.length === 0) return undefined;

  const embeds: APIEmbed[] = [];
  let budget = DISCORD_EMBED_LIMITS.totalCharacters;

  for (const item of input) {
    if (embeds.length >= DISCORD_EMBED_LIMITS.perMessage) break;
    if (budget <= 0) break;
    const normalized = normalizeDiscordEmbed(item);
    if (!normalized) continue;
    const embed = fitEmbedToBudget(normalized, budget);
    if (!embed) continue;
    budget -= embedCharacterCount(embed);
    embeds.push(embed);
  }

  return embeds.length > 0 ? embeds : undefined;
};
