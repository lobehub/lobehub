import { toRecord } from '@lobechat/utils/object';
import { htmlToText } from 'html-to-text';
import { z } from 'zod';

import {
  GMAIL_BODY_PREVIEW_MAX_LENGTH,
  GMAIL_DATE_MAX_LENGTH,
  GMAIL_EMAIL_SOURCE_MAX_LENGTH,
  GMAIL_LABEL_MAX_LENGTH,
  GMAIL_LABELS_MAX_COUNT,
  GMAIL_MESSAGE_ID_MAX_LENGTH,
  GMAIL_SNIPPET_MAX_LENGTH,
  GMAIL_SOURCE_URL_MAX_LENGTH,
  GMAIL_SUBJECT_MAX_LENGTH,
} from './constants';
import { clipGmailText, extractGmailEmail } from './normalize';
import type { GmailMessage } from './types';

const MAX_HEADERS = 50;
const MAX_MIME_CHILDREN = 16;
const MAX_MIME_DEPTH = 8;
const MAX_MIME_PARTS = 128;
const MAX_RAW_BODY_LENGTH = 32_000;
const MAX_RAW_ENCODED_BODY_LENGTH = 48_000;
const MAX_RESPONSE_RESULTS = 8;
const MAX_SEARCH_MESSAGE_CANDIDATES = 25;

const boundedString = (limit: number) => z.string().transform((value) => value.slice(0, limit));
const boundedLabels = z.preprocess(
  (value) => (Array.isArray(value) ? value.slice(0, GMAIL_LABELS_MAX_COUNT) : value),
  z.array(boundedString(GMAIL_LABEL_MAX_LENGTH + 1)),
);

const messageSchema = z.object({
  bodyHtml: boundedString(MAX_RAW_BODY_LENGTH).nullish(),
  bodyText: boundedString(MAX_RAW_BODY_LENGTH).nullish(),
  date: boundedString(GMAIL_DATE_MAX_LENGTH).nullish(),
  from: boundedString(GMAIL_EMAIL_SOURCE_MAX_LENGTH).nullish(),
  html: boundedString(MAX_RAW_BODY_LENGTH).nullish(),
  id: boundedString(GMAIL_MESSAGE_ID_MAX_LENGTH + 1).nullish(),
  internalDate: z.union([boundedString(64), z.number()]).nullish(),
  labelIds: boundedLabels.nullish(),
  labels: boundedLabels.nullish(),
  messageId: boundedString(GMAIL_MESSAGE_ID_MAX_LENGTH + 1).nullish(),
  messageText: boundedString(MAX_RAW_BODY_LENGTH).nullish(),
  messageTimestamp: z.union([boundedString(64), z.number()]).nullish(),
  messageUrl: boundedString(GMAIL_SOURCE_URL_MAX_LENGTH + 1).nullish(),
  payload: z.unknown().nullish(),
  preview: z
    .union([
      boundedString(GMAIL_BODY_PREVIEW_MAX_LENGTH + 1),
      z.object({ body: boundedString(GMAIL_BODY_PREVIEW_MAX_LENGTH + 1).nullish() }),
    ])
    .nullish(),
  sender: boundedString(GMAIL_EMAIL_SOURCE_MAX_LENGTH).nullish(),
  snippet: boundedString(GMAIL_SNIPPET_MAX_LENGTH + 1).nullish(),
  subject: boundedString(GMAIL_SUBJECT_MAX_LENGTH + 1).nullish(),
  text: boundedString(MAX_RAW_BODY_LENGTH).nullish(),
  threadId: boundedString(GMAIL_MESSAGE_ID_MAX_LENGTH + 1).nullish(),
  to: boundedString(GMAIL_EMAIL_SOURCE_MAX_LENGTH).nullish(),
});

const messageCollectionSchema = z.union([
  z.custom<unknown[]>(Array.isArray),
  z.object({ messages: z.custom<unknown[]>(Array.isArray) }).transform(({ messages }) => messages),
  z.object({ emails: z.custom<unknown[]>(Array.isArray) }).transform(({ emails }) => emails),
  z.object({ items: z.custom<unknown[]>(Array.isArray) }).transform(({ items }) => items),
]);
const executionDataSchema = z.union([
  z.object({ data: messageCollectionSchema }).transform(({ data }) => data),
  z.object({ data_preview: messageCollectionSchema }).transform(({ data_preview }) => data_preview),
]);
const resultExecutionSchema = z
  .object({ result: executionDataSchema })
  .transform(({ result }) => result);
const batchExecutionSchema = z.object({
  data: z.object({ results: z.custom<unknown[]>(Array.isArray) }),
});

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

    if (data && mimeType === 'text/plain') {
      return Buffer.from(data, 'base64url').toString('utf8').slice(0, MAX_RAW_BODY_LENGTH);
    }
    if (data && mimeType === 'text/html' && !html) html = data;
    if (data && current.depth === 0) root = data;
    if (current.depth >= MAX_MIME_DEPTH || !Array.isArray(part.parts)) continue;
    for (const child of part.parts.slice(0, MAX_MIME_CHILDREN)) {
      queue.push({ depth: current.depth + 1, part: child });
    }
  }

  if (html) {
    const decoded = Buffer.from(html, 'base64url').toString('utf8').slice(0, MAX_RAW_BODY_LENGTH);
    return htmlToText(decoded, { wordwrap: false });
  }
  return root
    ? Buffer.from(root, 'base64url').toString('utf8').slice(0, MAX_RAW_BODY_LENGTH)
    : undefined;
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
  const rawId = parsed.data.id ?? parsed.data.messageId;
  if (!rawId) return undefined;
  const id = clipGmailText(rawId, GMAIL_MESSAGE_ID_MAX_LENGTH)!;
  const rawSender =
    parsed.data.sender ?? parsed.data.from ?? getHeader(parsed.data.payload, 'From');
  const rawRecipient = parsed.data.to ?? getHeader(parsed.data.payload, 'To');
  const subject = clipGmailText(
    parsed.data.subject ?? getHeader(parsed.data.payload, 'Subject') ?? '(No subject)',
    GMAIL_SUBJECT_MAX_LENGTH,
  )!;
  const htmlBody = parsed.data.bodyHtml ?? parsed.data.html;
  const preview =
    typeof parsed.data.preview === 'string' ? parsed.data.preview : parsed.data.preview?.body;
  const directBody = parsed.data.messageText ?? parsed.data.bodyText ?? parsed.data.text;
  const body =
    directBody ||
    (htmlBody
      ? htmlToText(htmlBody.slice(0, MAX_RAW_BODY_LENGTH), { wordwrap: false })
      : (decodeGmailBody(parsed.data.payload) ?? preview));

  if (!rawSender && subject === '(No subject)' && !body && !parsed.data.snippet) return undefined;

  return {
    bodyPreview: clipGmailText(body ?? undefined, GMAIL_BODY_PREVIEW_MAX_LENGTH),
    date: normalizeDate(
      parsed.data.messageTimestamp ??
        parsed.data.internalDate ??
        parsed.data.date ??
        getHeader(parsed.data.payload, 'Date'),
    ),
    id,
    labels: (parsed.data.labelIds ?? parsed.data.labels ?? []).reduce<string[]>((labels, label) => {
      const normalized = clipGmailText(label, GMAIL_LABEL_MAX_LENGTH);
      if (normalized) labels.push(normalized);
      return labels;
    }, []),
    recipient: extractGmailEmail(rawRecipient),
    sender: extractGmailEmail(rawSender),
    snippet: clipGmailText(parsed.data.snippet ?? undefined, GMAIL_SNIPPET_MAX_LENGTH),
    sourceUrl: clipGmailText(
      parsed.data.messageUrl ??
        (parsed.data.threadId ? `gmail:thread:${parsed.data.threadId}` : `gmail:message:${id}`),
      GMAIL_SOURCE_URL_MAX_LENGTH,
    ),
    subject,
  };
};

export interface ParseGmailMessagesOptions {
  maxCandidates?: number;
}

export const parseGmailMessages = (
  value: unknown,
  { maxCandidates = MAX_SEARCH_MESSAGE_CANDIDATES }: ParseGmailMessagesOptions = {},
): GmailMessage[] | undefined => {
  const direct = messageCollectionSchema.safeParse(value);
  const execution = direct.success ? undefined : executionDataSchema.safeParse(value);
  const result =
    direct.success || execution?.success ? undefined : resultExecutionSchema.safeParse(value);
  let messages = direct.success ? direct.data : execution?.success ? execution.data : result?.data;

  if (!messages) {
    const batch = batchExecutionSchema.safeParse(value);
    if (batch.success) {
      const resultLimit = Math.min(batch.data.data.results.length, MAX_RESPONSE_RESULTS);
      for (let index = 0; index < resultLimit; index += 1) {
        const response = executionDataSchema.safeParse(
          toRecord(batch.data.data.results[index])?.response,
        );
        if (response.success) {
          messages = response.data;
          break;
        }
      }
    }
  }

  if (!messages) return undefined;
  const limit = Math.min(Math.max(0, Math.floor(maxCandidates)), MAX_SEARCH_MESSAGE_CANDIDATES);
  const deduplicated = new Map<string, GmailMessage>();

  for (let index = 0; index < Math.min(messages.length, limit); index += 1) {
    const candidate = messages[index];
    const candidateRecord = toRecord(candidate);
    const rawCandidateId = candidateRecord?.id ?? candidateRecord?.messageId;
    const id =
      typeof rawCandidateId === 'string'
        ? rawCandidateId.slice(0, GMAIL_MESSAGE_ID_MAX_LENGTH)
        : undefined;
    if (id && deduplicated.has(id)) continue;
    const message = normalizeMessage(candidate);
    if (message && !deduplicated.has(message.id)) deduplicated.set(message.id, message);
  }

  if (messages.length > 0 && limit > 0 && deduplicated.size === 0) return undefined;
  return [...deduplicated.values()];
};
