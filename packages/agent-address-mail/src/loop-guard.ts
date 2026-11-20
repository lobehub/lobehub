/**
 * Loop protection for inbound email.
 *
 * An agent that answers every arriving message will happily answer a vacation
 * autoresponder, a mailing-list blast, or the bounce notification its own
 * failed reply produced — and each of those answers produces another message.
 * The service exposes no arbitrary headers on the JSON message shape, so the
 * authoritative check runs against the raw `message/rfc822` source
 * (`GET /v1/messages/:id/raw`); address and subject heuristics cover the case
 * where the raw body is unavailable.
 */

const BOUNCE_SENDER = /^(?:mailer-daemon|mail-daemon|postmaster|mailer|bounce|no-?reply-bounces)@/i;

const BOUNCE_SUBJECT =
  /undelivered mail|delivery status notification|mail delivery (?:failed|failure)|returned mail|return to sender|failure notice|undeliverable|无法投递|投递失败|退信|傳送失敗/i;

const AUTO_REPLY_SUBJECT =
  /out of office|automatic repl|auto[- ]?repl|automatic response|auto[- ]?response|vacation|away from my (?:inbox|desk)|自动回复|自动答复|自动回覆|自动回信|休假|不在办公室/i;

/** Parse the header block of a raw RFC822 message into lower-cased keys. */
export const parseRawHeaders = (raw: string): Record<string, string> => {
  const headerBlock = raw.split(/\r?\n\r?\n/, 1)[0] ?? '';
  const headers: Record<string, string> = {};

  for (const line of headerBlock.split(/\r?\n/)) {
    if (/^[ \t]/.test(line)) {
      // Folded continuation of the previous header.
      const keys = Object.keys(headers);
      const last = keys.at(-1);
      if (last) headers[last] = `${headers[last]} ${line.trim()}`;
      continue;
    }
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    headers[key] = headers[key] ? `${headers[key]}, ${value}` : value;
  }

  return headers;
};

export type IgnoreReason =
  | 'auto_reply'
  | 'auto_response_suppress'
  | 'auto_submitted'
  | 'bounce'
  | 'mailing_list'
  | 'precedence_bulk'
  | 'self_addressed';

export interface IgnoreDecision {
  ignored: boolean;
  reason?: IgnoreReason;
}

/**
 * Decide whether an inbound message must not be handed to the agent.
 * `headers` may be `null` when the raw body could not be fetched — the
 * address/subject heuristics still apply.
 */
export const checkInboundEmail = (params: {
  from: string;
  headers?: Record<string, string> | null;
  inboxAddress?: string;
  subject?: null | string;
}): IgnoreDecision => {
  const { from, headers } = params;
  const subject = params.subject ?? '';

  if (params.inboxAddress && from && from.toLowerCase() === params.inboxAddress.toLowerCase()) {
    return { ignored: true, reason: 'self_addressed' };
  }

  if (BOUNCE_SENDER.test(from)) return { ignored: true, reason: 'bounce' };
  if (BOUNCE_SUBJECT.test(subject)) return { ignored: true, reason: 'bounce' };

  if (headers) {
    // RFC 3834: a legitimate automatic reply announces itself here. Anything
    // other than an explicit `no` means the message must not be answered.
    const autoSubmitted = headers['auto-submitted'];
    if (autoSubmitted && autoSubmitted.trim().toLowerCase() !== 'no') {
      return { ignored: true, reason: 'auto_submitted' };
    }

    const precedence = headers['precedence']?.trim().toLowerCase();
    if (precedence && ['bulk', 'junk', 'list'].includes(precedence)) {
      return { ignored: true, reason: 'precedence_bulk' };
    }

    if (headers['x-auto-response-suppress']) {
      return { ignored: true, reason: 'auto_response_suppress' };
    }

    // Mailing lists: replies would be broadcast to every subscriber.
    if (headers['list-id'] || headers['list-post']) {
      return { ignored: true, reason: 'mailing_list' };
    }

    // `Return-Path: <>` marks a bounce (the envelope sender is null).
    const returnPath = headers['return-path'];
    if (returnPath !== undefined && /^<\s*>$/.test(returnPath.trim())) {
      return { ignored: true, reason: 'bounce' };
    }
  }

  if (AUTO_REPLY_SUBJECT.test(subject)) return { ignored: true, reason: 'auto_reply' };

  return { ignored: false };
};
