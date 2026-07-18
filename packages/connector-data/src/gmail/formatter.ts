import { toXml } from 'xast-util-to-xml';
import { x } from 'xastscript';

import type { GmailMessage } from './types';

const DEFAULT_MAX_LENGTH = 48_000;
const MAX_BODY_PREVIEW_LENGTH = 520;
const MAX_DATE_LENGTH = 256;
const MAX_EMAIL_LENGTH = 320;
const MAX_LABEL_LENGTH = 80;
const MAX_LABELS = 20;
const MAX_MESSAGE_ID_LENGTH = 256;
const MAX_MESSAGES = 32;
const MAX_SNIPPET_LENGTH = 320;
const MAX_SOURCE_URL_LENGTH = 500;
const MAX_SUBJECT_LENGTH = 320;

const clip = (value: string | undefined, limit: number) => {
  if (!value) return undefined;
  const overflowed = value.length > limit;
  const clean = value.slice(0, limit).replaceAll('\u0000', '').trim();
  if (!clean || !overflowed) return clean;
  return `${clean.trimEnd()}...`;
};

const normalizeMessage = (message: GmailMessage): GmailMessage => {
  const labels: string[] = [];
  const labelLimit = Math.min(message.labels.length, MAX_LABELS);
  for (let index = 0; index < labelLimit; index += 1) {
    const label = clip(message.labels[index], MAX_LABEL_LENGTH);
    if (label) labels.push(label);
  }

  return {
    bodyPreview: clip(message.bodyPreview, MAX_BODY_PREVIEW_LENGTH),
    date: clip(message.date, MAX_DATE_LENGTH),
    id: clip(message.id, MAX_MESSAGE_ID_LENGTH) ?? '',
    labels,
    recipient: clip(message.recipient, MAX_EMAIL_LENGTH),
    sender: clip(message.sender, MAX_EMAIL_LENGTH),
    snippet: clip(message.snippet, MAX_SNIPPET_LENGTH),
    sourceUrl: clip(message.sourceUrl, MAX_SOURCE_URL_LENGTH),
    subject: clip(message.subject, MAX_SUBJECT_LENGTH) ?? '(No subject)',
  };
};

const createMessagesTree = (messages: GmailMessage[]) =>
  x(
    'gmailMessages',
    { count: String(messages.length) },
    messages.map((message) => {
      const children = [x('subject', message.subject)];
      if (message.sender) children.push(x('sender', message.sender));
      if (message.recipient) children.push(x('recipient', message.recipient));
      if (message.labels.length > 0) {
        children.push(
          x(
            'labels',
            message.labels.map((label) => x('label', label)),
          ),
        );
      }
      if (message.snippet) children.push(x('snippet', message.snippet));
      if (message.bodyPreview) children.push(x('bodyPreview', message.bodyPreview));

      const attributes = Object.fromEntries(
        Object.entries({
          date: message.date?.slice(0, 10),
          id: message.id,
          sourceUrl: message.sourceUrl,
        }).filter((entry): entry is [string, string] => entry[1] !== undefined),
      );
      return x('message', attributes, children);
    }),
  );

const serializeMessages = (messages: GmailMessage[]) => toXml(createMessagesTree(messages));
const EMPTY_MESSAGES_XML = serializeMessages([]);
const MIN_XML_LENGTH = EMPTY_MESSAGES_XML.length;

export interface ToGmailMessagesXmlOptions {
  maxLength?: number;
}

export const toGmailMessagesXml = (
  messages: GmailMessage[],
  { maxLength = DEFAULT_MAX_LENGTH }: ToGmailMessagesXmlOptions = {},
) => {
  const finiteMaxLength = Number.isFinite(maxLength) ? maxLength : DEFAULT_MAX_LENGTH;
  const limit = Math.min(Math.floor(finiteMaxLength), DEFAULT_MAX_LENGTH);
  if (limit < MIN_XML_LENGTH) {
    throw new RangeError(`Gmail XML maxLength must be at least ${MIN_XML_LENGTH}`);
  }
  const normalizedMessages: GmailMessage[] = [];
  const messageLimit = Math.min(messages.length, MAX_MESSAGES);
  for (let index = 0; index < messageLimit; index += 1) {
    normalizedMessages.push(normalizeMessage(messages[index]));
  }
  const selected: GmailMessage[] = [];

  for (const message of normalizedMessages) {
    const candidate = [...selected, message];
    if (serializeMessages(candidate).length > limit) break;
    selected.push(message);
  }

  return serializeMessages(selected);
};
