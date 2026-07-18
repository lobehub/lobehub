import { htmlToText } from 'html-to-text';
import { z } from 'zod';

import type { GmailMessage } from './types';

const MAX_BODY_PREVIEW_LENGTH = 520;
const MAX_EMAIL_LENGTH = 320;
const MAX_EMAIL_SOURCE_LENGTH = 2048;
const MAX_HEADERS = 50;
const MAX_LABEL_LENGTH = 80;
const MAX_LABELS = 20;
const MAX_MESSAGE_ID_LENGTH = 256;
const MAX_MIME_CHILDREN = 16;
const MAX_MIME_DEPTH = 8;
const MAX_MIME_PARTS = 128;
const MAX_RAW_BODY_LENGTH = 32_000;
const MAX_RAW_ENCODED_BODY_LENGTH = 48_000;
const MAX_RESPONSE_WRAPPER_DEPTH = 4;
const MAX_RESPONSE_RESULTS = 8;
const MAX_SEARCH_MESSAGE_CANDIDATES = 25;
const MAX_SNIPPET_LENGTH = 320;
const MAX_SOURCE_URL_LENGTH = 500;
const MAX_SUBJECT_LENGTH = 320;

const boundedString = (limit: number) => z.string().transform((value) => value.slice(0, limit));
const boundedLabels = z.preprocess(
  (value) => (Array.isArray(value) ? value.slice(0, MAX_LABELS) : value),
  z.array(boundedString(MAX_LABEL_LENGTH + 1)),
);

const messageSchema = z.object({
  bodyHtml: boundedString(MAX_RAW_BODY_LENGTH).nullish(),
  bodyText: boundedString(MAX_RAW_BODY_LENGTH).nullish(),
  date: boundedString(256).nullish(),
  from: boundedString(MAX_EMAIL_SOURCE_LENGTH).nullish(),
  html: boundedString(MAX_RAW_BODY_LENGTH).nullish(),
  id: boundedString(MAX_MESSAGE_ID_LENGTH + 1).nullish(),
  internalDate: z.union([boundedString(64), z.number()]).nullish(),
  labelIds: boundedLabels.nullish(),
  labels: boundedLabels.nullish(),
  messageId: boundedString(MAX_MESSAGE_ID_LENGTH + 1).nullish(),
  messageText: boundedString(MAX_RAW_BODY_LENGTH).nullish(),
  messageTimestamp: z.union([boundedString(64), z.number()]).nullish(),
  messageUrl: boundedString(MAX_SOURCE_URL_LENGTH + 1).nullish(),
  payload: z.unknown().nullish(),
  preview: z
    .union([
      boundedString(MAX_BODY_PREVIEW_LENGTH + 1),
      z.object({ body: boundedString(MAX_BODY_PREVIEW_LENGTH + 1).nullish() }),
    ])
    .nullish(),
  sender: boundedString(MAX_EMAIL_SOURCE_LENGTH).nullish(),
  snippet: boundedString(MAX_SNIPPET_LENGTH + 1).nullish(),
  subject: boundedString(MAX_SUBJECT_LENGTH + 1).nullish(),
  text: boundedString(MAX_RAW_BODY_LENGTH).nullish(),
  threadId: boundedString(MAX_MESSAGE_ID_LENGTH + 1).nullish(),
  to: boundedString(MAX_EMAIL_SOURCE_LENGTH).nullish(),
});

const toRecord = (value: unknown) => {
  if (typeof value !== 'object' || value === null) return undefined;
  return value as Record<PropertyKey, unknown>;
};

const clip = (value: string | undefined, limit: number) => {
  if (!value) return undefined;
  const overflowed = value.length > limit;
  const clean = value.slice(0, limit).replaceAll('\u0000', '').trim();
  if (!clean || !overflowed) return clean;
  return `${clean.trimEnd()}...`;
};

const extractEmail = (value?: string | null) => {
  const bounded = value?.slice(0, MAX_EMAIL_SOURCE_LENGTH);
  const match = bounded?.match(/<([^>]+)>/);
  return clip((match?.[1] ?? bounded)?.toLowerCase(), MAX_EMAIL_LENGTH);
};

const getHeader = (payload: unknown, name: string) => {
  const record = toRecord(payload);
  if (!record || !Array.isArray(record.headers)) return undefined;
  for (const value of record.headers.slice(0, MAX_HEADERS)) {
    const header = toRecord(value);
    if (!header || typeof header.name !== 'string' || typeof header.value !== 'string') continue;
    if (header.name.slice(0, 80).toLowerCase() !== name.toLowerCase()) continue;
    return header.value.slice(0, MAX_RAW_BODY_LENGTH);
  }
};

const decodeBase64UrlBody = (data: string) =>
  Buffer.from(data.slice(0, MAX_RAW_ENCODED_BODY_LENGTH), 'base64url')
    .toString('utf8')
    .slice(0, MAX_RAW_BODY_LENGTH);

const decodeGmailBody = (payload: unknown) => {
  const queue: Array<{ depth: number; part: unknown }> = [{ depth: 0, part: payload }];
  let html: string | undefined;
  let root: string | undefined;
  let visited = 0;

  while (queue.length > 0 && visited < MAX_MIME_PARTS) {
    const current = queue.shift()!;
    const part = toRecord(current.part);
    if (!part) continue;
    visited += 1;
    const body = toRecord(part.body);
    const data =
      typeof body?.data === 'string' ? body.data.slice(0, MAX_RAW_ENCODED_BODY_LENGTH) : undefined;
    const mimeType =
      typeof part.mimeType === 'string' ? part.mimeType.slice(0, 80).toLowerCase() : undefined;

    if (data && mimeType === 'text/plain') return decodeBase64UrlBody(data);
    if (data && mimeType === 'text/html' && !html) html = data;
    if (data && current.depth === 0) root = data;
    if (current.depth >= MAX_MIME_DEPTH || !Array.isArray(part.parts)) continue;
    for (const child of part.parts.slice(0, MAX_MIME_CHILDREN)) {
      queue.push({ depth: current.depth + 1, part: child });
    }
  }

  if (html) return htmlToText(decodeBase64UrlBody(html), { wordwrap: false });
  return root ? decodeBase64UrlBody(root) : undefined;
};

const normalizeDate = (value: string | number | null | undefined) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' && Number.isNaN(Number(value))) {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? undefined : date.toISOString();
  }
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return undefined;
  const date = new Date(milliseconds);
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString();
};

const normalizeMessage = (input: unknown): GmailMessage | undefined => {
  const parsed = messageSchema.safeParse(input);
  if (!parsed.success) return undefined;
  const message = parsed.data;
  const rawId = message.id ?? message.messageId;
  if (!rawId) return undefined;
  const id = clip(rawId, MAX_MESSAGE_ID_LENGTH)!;
  const rawSender = message.sender ?? message.from ?? getHeader(message.payload, 'From');
  const rawRecipient = message.to ?? getHeader(message.payload, 'To');
  const subject = clip(
    message.subject ?? getHeader(message.payload, 'Subject') ?? '(No subject)',
    MAX_SUBJECT_LENGTH,
  )!;
  const htmlBody = message.bodyHtml ?? message.html;
  const preview = typeof message.preview === 'string' ? message.preview : message.preview?.body;
  const directBody = message.messageText ?? message.bodyText ?? message.text;
  const body =
    directBody ||
    (htmlBody
      ? htmlToText(htmlBody.slice(0, MAX_RAW_BODY_LENGTH), { wordwrap: false })
      : (decodeGmailBody(message.payload) ?? preview ?? undefined));

  if (!rawSender && subject === '(No subject)' && !body && !message.snippet) return undefined;

  return {
    bodyPreview: clip(body, MAX_BODY_PREVIEW_LENGTH),
    date: normalizeDate(
      message.messageTimestamp ??
        message.internalDate ??
        message.date ??
        getHeader(message.payload, 'Date'),
    ),
    id,
    labels: (message.labelIds ?? message.labels ?? [])
      .slice(0, MAX_LABELS)
      .map((label) => clip(label, MAX_LABEL_LENGTH)!)
      .filter(Boolean),
    recipient: extractEmail(rawRecipient),
    sender: extractEmail(rawSender),
    snippet: clip(message.snippet ?? undefined, MAX_SNIPPET_LENGTH),
    sourceUrl: clip(
      message.messageUrl ??
        (message.threadId ? `gmail:thread:${message.threadId}` : `gmail:message:${id}`),
      MAX_SOURCE_URL_LENGTH,
    ),
    subject,
  };
};

const findMessagesArray = (value: unknown, depth = 0): unknown[] | undefined => {
  if (Array.isArray(value)) return value;
  const record = toRecord(value);
  if (!record) return undefined;
  for (const key of ['messages', 'emails', 'items']) {
    if (Array.isArray(record[key])) return record[key];
  }
  if (depth >= MAX_RESPONSE_WRAPPER_DEPTH) return undefined;
  if (Array.isArray(record.results)) {
    for (const result of record.results.slice(0, MAX_RESPONSE_RESULTS)) {
      const messages = findMessagesArray(result, depth + 1);
      if (messages) return messages;
    }
  }
  for (const key of ['data', 'data_preview', 'response', 'result']) {
    if (record[key] !== undefined) {
      const messages = findMessagesArray(record[key], depth + 1);
      if (messages) return messages;
    }
  }
};

const readMessageId = (value: unknown) => {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as { id?: unknown; messageId?: unknown };
  const id =
    typeof record.id === 'string'
      ? record.id
      : typeof record.messageId === 'string'
        ? record.messageId
        : undefined;
  return id?.slice(0, MAX_MESSAGE_ID_LENGTH);
};

export interface LoadGmailMessagesOptions {
  maxMessages?: number;
}

export const parseGmailMessages = (
  value: unknown,
  { maxMessages = MAX_SEARCH_MESSAGE_CANDIDATES }: LoadGmailMessagesOptions = {},
): GmailMessage[] | undefined => {
  const messages = findMessagesArray(value);
  if (!messages) return undefined;
  const limit = Math.min(Math.max(0, Math.floor(maxMessages)), MAX_SEARCH_MESSAGE_CANDIDATES);
  const deduplicated = new Map<string, GmailMessage>();

  for (let index = 0; index < Math.min(messages.length, limit); index += 1) {
    const candidate = messages[index];
    const id = readMessageId(candidate);
    if (id && deduplicated.has(id)) continue;
    const message = normalizeMessage(candidate);
    if (message && !deduplicated.has(message.id)) deduplicated.set(message.id, message);
  }

  if (messages.length > 0 && limit > 0 && deduplicated.size === 0) return undefined;
  return [...deduplicated.values()];
};

export const loadGmailMessages = (
  value: unknown,
  options: LoadGmailMessagesOptions = {},
): GmailMessage[] => parseGmailMessages(value, options) ?? [];
