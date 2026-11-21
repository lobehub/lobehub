import type { OpenAIChatMessage, UserMessageContentPart } from '../../types';
import { imageUrlToBase64 } from '../../utils/imageToBase64';
import { DownloadCache } from '../../utils/referenceImageCache';

/**
 * Request-size budget for images that a context builder inlines as base64.
 *
 * Anthropic-format providers cannot take image URLs, so every image in the
 * conversation is downloaded and re-sent as base64 on every request. A topic
 * that accumulates large images (screenshots, desktop `readFile` results)
 * eventually exceeds the provider's request body limit and every later send
 * fails with HTTP 413 — Anthropic rejects bodies over 32MB, DeepSeek's
 * Anthropic endpoint around 40–48MB, Bedrock lower still.
 *
 * This pre-pass keeps the inlined image bytes under a budget by replacing the
 * oldest images with a fixed text placeholder. Prompt caching constrains how:
 *
 * - The plan is a deterministic replay over the conversation in order, so the
 *   same messages always yield the same omissions, and appending messages can
 *   only omit more older images, never restore one (prefix stability).
 * - Omissions cut down to a low watermark rather than just under the budget.
 *   Each omission rewrites the cached prefix once; the headroom means the next
 *   rewrite waits until that much new image data has accumulated, instead of
 *   recurring on every later request.
 * - Images of the current turn are trimmed only after every earlier image, and
 *   the newest message and the latest user message never are, so the model
 *   always sees what it just asked for.
 *
 * Token accounting is unaffected: context-window counters and compaction
 * triggers already ignore image payloads, and this pass runs after them on a
 * copy of the messages.
 */

const MB = 1024 * 1024;

export interface InlineImage {
  base64: string;
  mimeType: string;
}

export interface InlineImageLimits {
  /** Largest allowed base64 length for one image. */
  maxBase64Bytes: number;
  /** Longest allowed edge in pixels. */
  maxLongEdge: number;
}

/**
 * Re-encodes an image to fit `limits`. Must be deterministic and must return the
 * input unchanged when it already fits, so requests stay byte-identical across
 * turns. Returning an image that still exceeds `maxBase64Bytes` omits it.
 */
export type InlineImageNormalizer = (
  image: InlineImage,
  limits: InlineImageLimits,
) => Promise<InlineImage>;

export interface InlineImageBudgetOptions {
  /** Fraction of the budget an omission cuts down to. */
  lowWatermark: number;
  /** Largest base64 length for one image. Anthropic rejects images over 5MB of base64. */
  maxImageBase64Bytes: number;
  /** Longest image edge. Anthropic rejects requests with more than 20 images over 2000px. */
  maxLongEdge: number;
  /** Total base64 length of all inlined images. */
  maxTotalBase64Bytes: number;
}

export const DEFAULT_INLINE_IMAGE_BUDGET: InlineImageBudgetOptions = {
  lowWatermark: 0.6,
  maxImageBase64Bytes: 5 * MB,
  // A fixed cap instead of resizing only once a request crosses 20 images: crossing
  // the threshold would otherwise re-encode every earlier image and rewrite the
  // whole cached prefix. Claude downsamples larger images anyway (1568px, 2576px
  // on high-resolution models).
  maxLongEdge: 2000,
  // Leaves room for text and tool definitions under Anthropic's 32MB body limit.
  maxTotalBase64Bytes: 20 * MB,
};

/** Fixed text so a trimmed request stays byte-identical across turns. */
export const OMITTED_IMAGE_PLACEHOLDER =
  '[Image omitted: an earlier image was removed to keep the request within the size limit]';

export const OVERSIZED_IMAGE_PLACEHOLDER =
  '[Image omitted: the image is too large to send to the model]';

let normalizer: InlineImageNormalizer | undefined;

/**
 * Registers the image re-encoder. The server installs a sharp-based one; the
 * browser runtime has none, so images there are only budgeted, not resized.
 */
export const setInlineImageNormalizer = (next: InlineImageNormalizer | undefined) => {
  normalizer = next;
};

/**
 * Normalized downloads, reused across the steps of one agent operation, which
 * resend the same images within seconds or minutes.
 */
const inlineImageCache = new DownloadCache({
  maxEntryBytes: 10 * MB,
  maxTotalBytes: 96 * MB,
  ttlMs: 5 * 60 * 1000,
});

/** Test helper. */
export const clearInlineImageCache = () => {
  inlineImageCache.clear();
};

export interface ImageSlot {
  /** Base64 length the image adds to the request. */
  bytes: number;
  /** Index of the message holding the image. */
  messageIndex: number;
  /** Index of the latest user message at or before `messageIndex`, or -1. */
  userAnchorIndex: number;
}

/**
 * Replays the conversation in order and returns the slot indices to omit.
 *
 * After each message's images are added, and at each user message, if the kept
 * total exceeds the budget, the oldest kept images are omitted until the total
 * drops to the low watermark, so earlier turns go before earlier tool images of
 * the current turn. Images in that message and in its latest user message are
 * never omitted. Checking at text-only user messages too lets a follow-up trim
 * an earlier message whose own images exceeded the budget while it was protected.
 * Decisions depend only on messages up to the one being processed.
 */
export const planImageOmissions = (
  slots: ImageSlot[],
  options: Pick<InlineImageBudgetOptions, 'lowWatermark' | 'maxTotalBase64Bytes'>,
  /** Indices of user messages, in order; each is a checkpoint even without images. */
  userMessageIndices: number[] = [],
): Set<number> => {
  const omitted = new Set<number>();
  const kept: number[] = [];
  let keptBytes = 0;
  const target = options.maxTotalBase64Bytes * options.lowWatermark;

  const trim = (messageIndex: number, userAnchorIndex: number) => {
    if (keptBytes <= options.maxTotalBase64Bytes) return;
    // Oldest first, so earlier turns go before earlier tool images of this turn.
    for (let k = 0; k < kept.length && keptBytes > target;) {
      const slot = slots[kept[k]];
      if (slot.messageIndex === messageIndex || slot.messageIndex === userAnchorIndex) {
        k++;
        continue;
      }
      keptBytes -= slot.bytes;
      omitted.add(kept[k]);
      kept.splice(k, 1);
    }
  };

  let start = 0;
  let user = 0;
  while (start < slots.length || user < userMessageIndices.length) {
    const nextSlotMessage = start < slots.length ? slots[start].messageIndex : Infinity;
    const nextUserMessage = user < userMessageIndices.length ? userMessageIndices[user] : Infinity;

    if (nextUserMessage < nextSlotMessage) {
      trim(nextUserMessage, nextUserMessage);
      user++;
      continue;
    }
    if (nextUserMessage === nextSlotMessage) user++;

    const { messageIndex, userAnchorIndex } = slots[start];
    let end = start;
    for (; end < slots.length && slots[end].messageIndex === messageIndex; end++) {
      kept.push(end);
      keptBytes += slots[end].bytes;
    }
    trim(messageIndex, userAnchorIndex);
    start = end;
  }

  return omitted;
};

const isRemoteUrl = (url: string) => /^https?:\/\//i.test(url);

const BASE64_MARKER = ';base64,';

/** indexOf instead of a regex: data URIs can be tens of megabytes. */
const splitBase64DataUri = (url: string): InlineImage | undefined => {
  if (!url.startsWith('data:')) return;
  const markerIndex = url.indexOf(BASE64_MARKER);
  if (markerIndex <= 5) return;
  const base64 = url.slice(markerIndex + BASE64_MARKER.length);
  if (!base64) return;
  return { base64, mimeType: url.slice(5, markerIndex) };
};

const normalize = async (image: InlineImage, options: InlineImageBudgetOptions) => {
  if (!normalizer) return image;
  try {
    return await normalizer(image, {
      maxBase64Bytes: options.maxImageBase64Bytes,
      maxLongEdge: options.maxLongEdge,
    });
  } catch (error) {
    console.error('Error normalizing inline image:', error);
    return image;
  }
};

const resolveImage = async (
  url: string,
  options: InlineImageBudgetOptions,
): Promise<InlineImage | undefined> => {
  const dataUri = splitBase64DataUri(url);
  if (dataUri) return normalize(dataUri, options);

  // Leave anything else to the block builder, which reports invalid URLs.
  if (!isRemoteUrl(url)) return undefined;

  const load = async () => normalize(await imageUrlToBase64(url), options);

  return inlineImageCache.get(
    `inline:${options.maxLongEdge}:${options.maxImageBase64Bytes}:${url}`,
    load,
    (value) => value.base64.length,
  );
};

interface ImageRef {
  messageIndex: number;
  partIndex: number;
}

/**
 * Inlines every image as a data URI and replaces those outside the budget with
 * text placeholders. Returns new message objects; the input is not mutated.
 */
export const inlineImagesWithinBudget = async (
  messages: OpenAIChatMessage[],
  overrides: Partial<InlineImageBudgetOptions> = {},
): Promise<OpenAIChatMessage[]> => {
  const options = { ...DEFAULT_INLINE_IMAGE_BUDGET, ...overrides };

  // Orphan tool results degrade to plain text in the builders, so leave their URLs alone.
  const toolCallIds = new Set(
    messages.flatMap((message) => message.tool_calls?.map((call) => call.id) ?? []),
  );

  const refs: ImageRef[] = [];
  const anchors: number[] = [];
  const userMessageIndices: number[] = [];
  let userAnchorIndex = -1;
  messages.forEach((message, messageIndex) => {
    if (message.role === 'user') {
      userAnchorIndex = messageIndex;
      userMessageIndices.push(messageIndex);
    }
    if (
      message.role === 'tool' &&
      (!message.tool_call_id || !toolCallIds.has(message.tool_call_id))
    )
      return;
    if (!Array.isArray(message.content)) return;
    message.content.forEach((part, partIndex) => {
      if (part.type !== 'image_url') return;
      refs.push({ messageIndex, partIndex });
      anchors.push(userAnchorIndex);
    });
  });

  if (refs.length === 0) return messages;

  const images = await Promise.all(
    refs.map(({ messageIndex, partIndex }) => {
      const part = (messages[messageIndex].content as UserMessageContentPart[])[partIndex];
      return resolveImage((part as { image_url: { url: string } }).image_url.url, options);
    }),
  );

  const oversized = new Set<number>();
  const slots: ImageSlot[] = refs.map(({ messageIndex }, index) => {
    const bytes = images[index]?.base64.length ?? 0;
    if (bytes > options.maxImageBase64Bytes) oversized.add(index);
    return {
      bytes: oversized.has(index) ? 0 : bytes,
      messageIndex,
      userAnchorIndex: anchors[index],
    };
  });
  const omitted = planImageOmissions(slots, options, userMessageIndices);

  const replacements = new Map<number, Map<number, UserMessageContentPart>>();
  refs.forEach(({ messageIndex, partIndex }, index) => {
    const image = images[index];
    let part: UserMessageContentPart | undefined;
    if (oversized.has(index)) part = { text: OVERSIZED_IMAGE_PLACEHOLDER, type: 'text' };
    else if (omitted.has(index)) part = { text: OMITTED_IMAGE_PLACEHOLDER, type: 'text' };
    else if (image) {
      part = {
        image_url: { url: `data:${image.mimeType};base64,${image.base64}` },
        type: 'image_url',
      };
    }
    if (!part) return;
    const parts = replacements.get(messageIndex) ?? new Map();
    parts.set(partIndex, part);
    replacements.set(messageIndex, parts);
  });

  return messages.map((message, messageIndex) => {
    const parts = replacements.get(messageIndex);
    if (!parts) return message;
    return {
      ...message,
      content: (message.content as UserMessageContentPart[]).map(
        (part, partIndex) => parts.get(partIndex) ?? part,
      ),
    };
  });
};
