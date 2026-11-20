/**
 * Text and outbound-attachment extraction from completion messages.
 */
import { deserializeParts } from '@lobechat/utils';
import { isRecord } from '@lobechat/utils/object';

import { extractFinalReplyImageUrls } from '../finalReplyImages';

// --------------------------------------------------------------------------
// Outbound attachment extraction
// --------------------------------------------------------------------------

type OutboundAttachment = {
  data?: string;
  fetchUrl?: string;
  mimeType?: string;
  name?: string;
  type: 'image' | 'file' | 'video' | 'audio';
};

const DATA_URL_RE = /^data:([^;]+);base64,(.+)$/;

const inferAttachmentTypeFromMime = (mimeType: string | undefined): OutboundAttachment['type'] => {
  if (!mimeType) return 'file';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'file';
};

/**
 * Materialize a `url` field — either a `data:` URL (extract base64 inline) or
 * a remote URL (record fetchUrl). Returns undefined for unsupported shapes.
 */
const buildAttachmentFromUrl = (
  url: string | undefined,
  fallbackType: OutboundAttachment['type'] = 'image',
): OutboundAttachment | undefined => {
  if (!url || typeof url !== 'string') return undefined;
  const dataMatch = url.match(DATA_URL_RE);
  if (dataMatch) {
    const mimeType = dataMatch[1];
    return {
      data: dataMatch[2],
      mimeType,
      type: inferAttachmentTypeFromMime(mimeType),
    };
  }
  // Bare http(s) URL — let the downstream messenger fetch it lazily.
  if (/^https?:\/\//.test(url)) {
    return { fetchUrl: url, type: fallbackType };
  }
  return undefined;
};

/**
 * Pull text out of a message's `content` field. Accepts both string and
 * OpenAI-style multimodal arrays `[{ type: 'text', text }, { type: 'image_url', image_url: { url } }]`.
 */
export const extractTextFromMessageContent = (content: unknown): string | undefined => {
  if (typeof content === 'string') return content || undefined;
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === 'string') {
      parts.push(part);
    } else if (part && typeof part === 'object' && (part as any).type === 'text') {
      const text = (part as { text?: unknown }).text;
      if (typeof text === 'string') parts.push(text);
    }
  }
  const joined = parts.join('');
  return joined || undefined;
};

/**
 * Extract text from either an in-memory message or a DB-rehydrated row.
 * Persisted multimodal content is serialized, so only deserialize when the
 * row's explicit metadata flag identifies that storage representation.
 */
export const extractTextFromMessage = (message: unknown): string | undefined => {
  if (!isRecord(message)) return undefined;

  const metadata = isRecord(message.metadata) ? message.metadata : undefined;
  const content =
    typeof message.content === 'string' && metadata?.isMultimodal === true
      ? (deserializeParts(message.content) ?? message.content)
      : message.content;

  return extractTextFromMessageContent(content);
};

/**
 * Expand display-only assistant groups back into the assistant/tool sequence
 * expected by terminal lifecycle consumers.
 *
 * DB rehydration runs conversation-flow parsing, which folds an entire tool
 * chain — including its final toolless assistant turn — into one
 * `assistantGroup` whose own content is empty. Completion hooks must inspect
 * the persisted leaf turns rather than that virtual wrapper, otherwise they
 * lose both the final text and the message id used by DB recovery.
 */
export const normalizeCompletionMessages = (
  messages: unknown[],
): Record<PropertyKey, unknown>[] => {
  const normalized: Record<PropertyKey, unknown>[] = [];

  for (const message of messages) {
    if (!isRecord(message)) continue;

    const isAssistantGroup = message.role === 'assistantGroup' || message.role === 'supervisor';
    if (!isAssistantGroup) {
      normalized.push(message);
      continue;
    }

    if (!Array.isArray(message.children) || message.children.length === 0) {
      normalized.push({ ...message, role: 'assistant' });
      continue;
    }

    const groupStartIndex = normalized.length;
    for (const child of message.children) {
      if (!isRecord(child) || child.council) continue;

      normalized.push({ ...child, role: 'assistant' });

      if (!Array.isArray(child.tools)) continue;
      for (const tool of child.tools) {
        if (!isRecord(tool) || !isRecord(tool.result)) continue;

        normalized.push({
          content: tool.result.content,
          id: tool.result.id,
          role: 'tool',
          tool_call_id: tool.id,
        });
      }
    }

    // A virtual group containing only non-message blocks (for example a
    // council block) still marks the latest assistant boundary. Preserve an
    // empty leaf so completion never falls back to stale text from an older
    // turn.
    if (normalized.length === groupStartIndex) {
      normalized.push({ ...message, role: 'assistant' });
    }
  }

  return normalized;
};

/**
 * Find the final assistant boundary after display-only groups have been
 * normalized. Match by role rather than content so an empty/image-only final
 * turn never falls through to stale text from an earlier assistant message.
 */
export const findLastAssistantMessage = (
  messages: Record<PropertyKey, unknown>[],
): Record<PropertyKey, unknown> | undefined =>
  messages
    .slice()
    .reverse()
    .find((message) => message.role === 'assistant');

/**
 * Extract image/file parts from a message's `content` array. Each entry is
 * mapped to the JSON-safe outbound attachment shape (data or fetchUrl).
 */
const extractAttachmentsFromContent = (content: unknown): OutboundAttachment[] => {
  if (!Array.isArray(content)) return [];
  const out: OutboundAttachment[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const type = (part as { type?: unknown }).type;
    if (type === 'image_url') {
      const url = (part as { image_url?: { url?: string } }).image_url?.url;
      const att = buildAttachmentFromUrl(url, 'image');
      if (att) out.push(att);
    } else if (type === 'image') {
      // Anthropic-style: { type: 'image', source: { type: 'base64', media_type, data } }
      const source = (part as { source?: { data?: string; media_type?: string; type?: string } })
        .source;
      if (source?.type === 'base64' && source.data) {
        const mimeType = source.media_type;
        out.push({
          data: source.data,
          mimeType,
          type: inferAttachmentTypeFromMime(mimeType),
        });
      } else if (source?.type === 'url') {
        const url = (source as { url?: string }).url;
        const att = buildAttachmentFromUrl(url, 'image');
        if (att) out.push(att);
      }
    } else if (type === 'file' || type === 'file_url') {
      const file = (part as { file?: { url?: string; name?: string; mime_type?: string } }).file;
      const att = buildAttachmentFromUrl(file?.url, 'file');
      if (att) {
        att.name = file?.name ?? att.name;
        att.mimeType = file?.mime_type ?? att.mimeType;
        out.push(att);
      }
    }
  }
  return out;
};

/**
 * Walk recent messages and collect outbound image/file attachments to send
 * alongside the reply. Scans the last assistant message *and* any tool
 * messages that came after the previous assistant turn — tool-generated
 * images (e.g. a drawing tool that returns an image_url result) need to be
 * delivered with the next reply.
 *
 * Deduplicates by data/fetchUrl identity.
 */
export const extractOutboundAttachments = (messages: any[]): OutboundAttachment[] => {
  if (!Array.isArray(messages) || messages.length === 0) return [];

  // Walk from the end backwards: collect attachments until we hit the
  // previous assistant turn that already has text — that boundary marks
  // "the current reply window".
  const collected: OutboundAttachment[] = [];
  let crossedFinalAssistant = false;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || typeof msg !== 'object') continue;
    const role = (msg as { role?: string }).role;
    const content = (msg as { content?: unknown }).content;

    if (role === 'assistant') {
      if (!crossedFinalAssistant) {
        // Only the final reply's Markdown expresses an intent to send images.
        // Do not promote generation state or intermediate tool Markdown.
        const attachments: OutboundAttachment[] = [];
        const text = extractTextFromMessageContent(content);
        if (text) {
          for (const url of extractFinalReplyImageUrls(text)) {
            const attachment = buildAttachmentFromUrl(url, 'image');
            if (attachment) attachments.push(attachment);
          }
        }
        attachments.push(...extractAttachmentsFromContent(content));
        collected.unshift(...attachments);
        crossedFinalAssistant = true;
        continue;
      }
      // A previous assistant turn — stop walking, we don't want to dredge up
      // attachments from prior conversation rounds.
      break;
    }

    if (role === 'tool') {
      // Tool results between the previous assistant turn and the final one.
      collected.unshift(...extractAttachmentsFromContent(content));
    }
  }

  // Prepending each message preserves both message and within-message order.
  const seen = new Set<string>();
  const result: OutboundAttachment[] = [];
  for (const att of collected) {
    const key = att.fetchUrl ?? att.data ?? '';
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(att);
  }
  return result;
};
