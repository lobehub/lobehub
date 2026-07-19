import { toXml } from 'xast-util-to-xml';
import { x } from 'xastscript';

import {
  GMAIL_BODY_PREVIEW_MAX_LENGTH,
  GMAIL_DATE_MAX_LENGTH,
  GMAIL_EMAIL_MAX_LENGTH,
  GMAIL_LABEL_MAX_LENGTH,
  GMAIL_LABELS_MAX_COUNT,
  GMAIL_MESSAGE_ID_MAX_LENGTH,
  GMAIL_SNIPPET_MAX_LENGTH,
  GMAIL_SOURCE_URL_MAX_LENGTH,
  GMAIL_SUBJECT_MAX_LENGTH,
} from './constants';
import { clipGmailText } from './normalize';
import type { GmailMessage } from './types';

const DEFAULT_MAX_LENGTH = 48_000;
const MAX_MESSAGES = 32;

const normalizeMessage = (message: GmailMessage): GmailMessage => {
  const labels: string[] = [];
  const labelLimit = Math.min(message.labels.length, GMAIL_LABELS_MAX_COUNT);
  for (let index = 0; index < labelLimit; index += 1) {
    const label = clipGmailText(message.labels[index], GMAIL_LABEL_MAX_LENGTH);
    if (label) labels.push(label);
  }

  return {
    bodyPreview: clipGmailText(message.bodyPreview, GMAIL_BODY_PREVIEW_MAX_LENGTH),
    date: clipGmailText(message.date, GMAIL_DATE_MAX_LENGTH),
    id: clipGmailText(message.id, GMAIL_MESSAGE_ID_MAX_LENGTH) ?? '',
    labels,
    recipient: clipGmailText(message.recipient, GMAIL_EMAIL_MAX_LENGTH),
    sender: clipGmailText(message.sender, GMAIL_EMAIL_MAX_LENGTH),
    snippet: clipGmailText(message.snippet, GMAIL_SNIPPET_MAX_LENGTH),
    sourceUrl: clipGmailText(message.sourceUrl, GMAIL_SOURCE_URL_MAX_LENGTH),
    subject: clipGmailText(message.subject, GMAIL_SUBJECT_MAX_LENGTH) ?? '(No subject)',
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

const EMPTY_MESSAGES_XML = toXml(createMessagesTree([]));
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
  const selected: GmailMessage[] = [];
  const messageLimit = Math.min(messages.length, MAX_MESSAGES);
  for (let index = 0; index < messageLimit; index += 1) {
    const message = normalizeMessage(messages[index]);
    const candidate = [...selected, message];
    if (toXml(createMessagesTree(candidate)).length > limit) break;
    selected.push(message);
  }

  return toXml(createMessagesTree(selected));
};
