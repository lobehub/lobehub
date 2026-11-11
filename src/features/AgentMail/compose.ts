import type { AgentMailAddress, AgentMailComposeMode } from '@lobechat/types';
import { useSyncExternalStore } from 'react';
import { z } from 'zod';

import type { AgentAccountView, AgentMailRow } from '@/services/agentAccount';

/** Everything a person types into the composer. */
export interface ComposeFields {
  bcc: AgentMailAddress[];
  cc: AgentMailAddress[];
  subject: string;
  text: string;
  to: AgentMailAddress[];
}

export const EMPTY_FIELDS: ComposeFields = { bcc: [], cc: [], subject: '', text: '', to: [] };

/** Saved this long after the last keystroke (spec §4.4). */
export const DRAFT_SAVE_DELAY_MS = 1500;

/** Replies answer a mail; their recipients and subject come from it. */
export const isReplyMode = (mode: AgentMailComposeMode) => mode === 'reply' || mode === 'replyAll';

// The rule the mail routes validate recipients with, so what is marked here is
// exactly what the server would refuse. The provider still has the final word.
const addressSchema = z.email();

export const isValidAddress = (address: string) => addressSchema.safeParse(address.trim()).success;

/** What a draft can store: the server refuses a draft holding a malformed address. */
export const withoutInvalid = (list: AgentMailAddress[]) =>
  list.filter((item) => isValidAddress(item.address));

/** `Name <a@b.c>`, `<a@b.c>` or a bare `a@b.c`, as one recipient. */
export const parseAddress = (raw: string): AgentMailAddress => {
  const value = raw.trim();
  const match = /^(.*?)<([^<>]+)>$/.exec(value);
  if (!match) return { address: value };
  const name = match[1].trim().replace(/^"(.*)"$/, '$1');
  return name ? { address: match[2].trim(), name } : { address: match[2].trim() };
};

/** Splits typed or pasted text into recipients; commas, semicolons and line breaks separate them. */
/** Whether `raw` has a comma, semicolon or line break that is not inside a quoted name. */
export const hasSeparator = (raw: string) => {
  let quoted = false;
  for (const char of raw) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && /[\n,;]/.test(char)) return true;
  }
  return false;
};

export const parseAddressList = (raw: string): AgentMailAddress[] => {
  // A quoted display name may hold a comma: `"Doe, John" <j@x.com>` is one recipient.
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  for (const char of raw) {
    if (char === '"') quoted = !quoted;
    if (!quoted && /[\n,;]/.test(char)) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .map(parseAddress);
};

export const formatAddress = ({ address, name }: AgentMailAddress) =>
  name ? `${name} <${address}>` : address;

const sameAddress = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Adds recipients, skipping any already on the list. */
export const mergeAddresses = (list: AgentMailAddress[], added: AgentMailAddress[]) => {
  const next = [...list];
  for (const item of added) {
    if (!next.some((existing) => sameAddress(existing.address, item.address))) next.push(item);
  }
  return next;
};

export const invalidAddresses = (fields: Pick<ComposeFields, 'bcc' | 'cc' | 'to'>) =>
  [...fields.to, ...fields.cc, ...fields.bcc]
    .map((item) => item.address)
    .filter((address) => !isValidAddress(address));

export const replySubject = (subject: string | null | undefined) => {
  const value = subject ?? '';
  return /^re:/i.test(value) ? value : `Re: ${value}`;
};

export const forwardSubject = (subject: string | null | undefined) => {
  const value = subject ?? '';
  return /^(fwd?|fw):/i.test(value) ? value : `Fwd: ${value}`;
};

/**
 * What a reply answers: the newest mail received. A conversation holding only
 * mail this address sent has nothing to answer (the server refuses it too).
 */
export const replySourceOf = (mails: AgentMailRow[]): AgentMailRow | undefined =>
  mails.findLast((mail) => mail.direction === 'inbound');

/**
 * Who a reply goes to, as the provider's reply route picks them: `Reply-To` or
 * the sender, and with reply-all everyone else on the mail but this address.
 * Shown for the person's benefit only; the server decides.
 */
export const replyRecipients = (
  source: Pick<AgentMailRow, 'cc' | 'fromAddress' | 'fromName' | 'replyTo' | 'to'>,
  ownAddress: string,
  replyAll: boolean,
): Pick<ComposeFields, 'cc' | 'to'> => {
  const to: AgentMailAddress[] =
    source.replyTo.length > 0
      ? source.replyTo
      : [
          source.fromName
            ? { address: source.fromAddress, name: source.fromName }
            : { address: source.fromAddress },
        ];
  if (!replyAll) return { cc: [], to };

  const cc = [...source.to, ...source.cc].filter(
    ({ address }) =>
      !sameAddress(address, ownAddress) &&
      !to.some((target) => sameAddress(target.address, address)),
  );
  return { cc: mergeAddresses([], cc), to };
};

/** The original below a reply, each line marked as quoted. */
export const quoteForReply = (source: Pick<AgentMailRow, 'text'>, header: string) =>
  !source.text.trim()
    ? ''
    : `\n\n${header}\n${source.text
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n')}`;

/**
 * The original below a forward. Matches the server's own block, which it only
 * adds when the text does not already carry the original, so it never doubles.
 * A mail with no plain text (HTML only) gets none here: the server's check
 * cannot see an empty original, and would add its block a second time.
 */
export const quoteForForward = (
  source: Pick<AgentMailRow, 'fromAddress' | 'fromName' | 'subject' | 'text'>,
) =>
  !source.text.trim()
    ? ''
    : [
        '',
        '',
        '---------- Forwarded message ---------',
        `From: ${source.fromName ? `${source.fromName} <${source.fromAddress}>` : source.fromAddress}`,
        `Subject: ${source.subject ?? ''}`,
        '',
        source.text,
      ].join('\n');

/** What a new composer starts with, before anything is typed. */
export const initialFieldsFor = (
  mode: AgentMailComposeMode,
  source: AgentMailRow | undefined,
  ownAddress: string,
  replyHeader: string,
): ComposeFields => {
  if (!source || mode === 'compose') return EMPTY_FIELDS;
  if (mode === 'forward') {
    return {
      ...EMPTY_FIELDS,
      subject: forwardSubject(source.subject),
      text: quoteForForward(source),
    };
  }
  return {
    ...EMPTY_FIELDS,
    ...replyRecipients(source, ownAddress, mode === 'replyAll'),
    subject: replySubject(source.subject),
    text: quoteForReply(source, replyHeader),
  };
};

export const sameFields = (a: ComposeFields, b: ComposeFields) =>
  a.subject === b.subject &&
  a.text === b.text &&
  (['to', 'cc', 'bcc'] as const).every(
    (key) =>
      a[key].length === b[key].length &&
      a[key].every((item, index) => sameAddress(item.address, b[key][index].address)),
  );

/** A saved draft holding nothing a person wrote. */
export const isBlankDraft = (draft: {
  bcc: unknown[];
  cc: unknown[];
  subject: string | null;
  text: string;
  to: unknown[];
}) =>
  !draft.text.trim() &&
  !draft.subject?.trim() &&
  draft.to.length === 0 &&
  draft.cc.length === 0 &&
  draft.bcc.length === 0;

// --------------- Whether this address may send ---------------

/**
 * Why the address cannot send right now, known before anything is sent:
 * - `receive_only`: it only receives mail (its capabilities, or the provider
 *   refused a send from it as receive-only recently).
 * - `limit_reached`: today's quota ran out on an earlier send.
 * - `suspended` / `released`: the address is not active.
 */
export type SendBlock = 'limit_reached' | 'receive_only' | 'released' | 'suspended';

interface RememberedBlock {
  block: Extract<SendBlock, 'limit_reached' | 'receive_only'>;
  until: number;
}

const BLOCK_KEY = (accountId: string) => `lobe-agent-mail:send-block:${accountId}`;

let blockVersion = 0;
const blockListeners = new Set<() => void>();
const blocksChanged = () => {
  blockVersion += 1;
  for (const listener of blockListeners) listener();
};

/**
 * Re-renders when a refusal is remembered or forgotten, so every entry on the
 * page (the header's Compose, the answers, the notice) changes together.
 */
export const useSendBlockVersion = () =>
  useSyncExternalStore(
    (listener) => {
      blockListeners.add(listener);
      return () => blockListeners.delete(listener);
    },
    () => blockVersion,
    () => blockVersion,
  );

/** A receive-only refusal is taken at its word for a day; a plan change may lift it sooner. */
const RECEIVE_ONLY_MEMORY_MS = 24 * 60 * 60 * 1000;

const nextLocalMidnight = (now: number) => {
  const date = new Date(now);
  date.setHours(24, 0, 0, 0);
  return date.getTime();
};

const storage = (): Storage | undefined => {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
};

/**
 * Remember what a refused send said about the address, so the next composer
 * says so before the person writes and sends again. LobeHub has no read of the
 * provider's quota yet, so the refusal itself is the only signal there is.
 */
export const rememberSendRefusal = (
  accountId: string,
  code: string | undefined,
  now = Date.now(),
) => {
  const block: RememberedBlock | undefined =
    code === 'send_disabled'
      ? { block: 'receive_only', until: now + RECEIVE_ONLY_MEMORY_MS }
      : code === 'send_limit_daily'
        ? { block: 'limit_reached', until: nextLocalMidnight(now) }
        : undefined;
  if (!block) return;
  storage()?.setItem(BLOCK_KEY(accountId), JSON.stringify(block));
  blocksChanged();
};

export const forgetSendRefusal = (accountId: string) => {
  if (!storage()?.getItem(BLOCK_KEY(accountId))) return;
  storage()?.removeItem(BLOCK_KEY(accountId));
  blocksChanged();
};

const rememberedBlock = (accountId: string, now: number): SendBlock | undefined => {
  const raw = storage()?.getItem(BLOCK_KEY(accountId));
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as RememberedBlock;
    if (parsed.until > now) return parsed.block;
  } catch {
    // unreadable: fall through and drop it
  }
  // Read during render, so it is dropped quietly rather than announced.
  storage()?.removeItem(BLOCK_KEY(accountId));
  return undefined;
};

export const sendBlockOf = (
  account: Pick<AgentAccountView, 'capabilities' | 'id' | 'status'> | undefined,
  now = Date.now(),
): SendBlock | undefined => {
  if (!account || account.status === 'revoked') return 'released';
  if (account.status === 'suspended') return 'suspended';
  if (!account.capabilities.send) return 'receive_only';
  return rememberedBlock(account.id, now);
};

/** Only a remembered refusal can be lifted from the client; the rest are the address's state. */
export const isRememberedBlock = (
  account: Pick<AgentAccountView, 'capabilities' | 'status'>,
  block: SendBlock | undefined,
) =>
  (block === 'receive_only' || block === 'limit_reached') &&
  account.capabilities.send &&
  account.status !== 'suspended';

export const SEND_BLOCK_KEYS = {
  limit_reached: 'identity.compose.block.limitReached',
  receive_only: 'identity.compose.block.receiveOnly',
  released: 'identity.compose.block.released',
  suspended: 'identity.compose.block.suspended',
} as const satisfies Record<SendBlock, string>;

// --------------- Send failures ---------------

export interface SendFailure {
  code?: string;
  /** Locale key of what to tell the person. */
  key: SendFailureKey;
  /** The server's message, for the refusals that carry a reason (a rejected recipient). */
  reason?: string;
  /** Trying again as-is may work: nothing was wrong with the mail itself. */
  retryable: boolean;
}

const FAILURE_KEYS = {
  account_not_found: { key: 'identity.compose.error.unavailable', retryable: false },
  account_unavailable: { key: 'identity.compose.error.unavailable', retryable: false },
  draft_not_found: { key: 'identity.compose.error.draftGone', retryable: false },
  draft_sending: { key: 'identity.compose.error.alreadySending', retryable: false },
  recipient_looping: { key: 'identity.compose.error.looping', retryable: false },
  recipients_required: { key: 'identity.compose.error.recipientsRequired', retryable: false },
  reply_target_gone: { key: 'identity.compose.error.targetGone', retryable: false },
  reply_target_not_owned: { key: 'identity.compose.error.targetGone', retryable: false },
  send_disabled: { key: 'identity.compose.block.receiveOnly', retryable: false },
  send_failed: { key: 'identity.compose.error.failed', retryable: true },
  send_limit_daily: { key: 'identity.compose.block.limitReached', retryable: false },
  send_limit_hourly: { key: 'identity.compose.error.limitHourly', retryable: false },
  send_rejected: { key: 'identity.compose.error.rejected', retryable: false },
  send_suspended: { key: 'identity.compose.error.suspended', retryable: false },
} as const satisfies Record<string, { key: string; retryable: boolean }>;

export type SendFailureKey = (typeof FAILURE_KEYS)[keyof typeof FAILURE_KEYS]['key'];

/** Turns a failed save or send into what the composer says, keyed on the server's `errorData.code`. */
export const sendFailureOf = (error: unknown): SendFailure => {
  const data = (error as { data?: { errorData?: { code?: unknown } } } | undefined)?.data;
  const code = typeof data?.errorData?.code === 'string' ? data.errorData.code : undefined;
  const known = code
    ? (FAILURE_KEYS as Record<string, { key: SendFailureKey; retryable: boolean }>)[code]
    : undefined;
  if (!known) return { code, key: 'identity.compose.error.failed', retryable: true };
  return {
    ...known,
    code,
    // The provider's own words name the refused recipient; nothing else is shown raw.
    reason: code === 'send_rejected' ? (error as Error).message : undefined,
  };
};

// --------------- Local backup ---------------

/**
 * Each keystroke is also kept in this browser, so a lost connection or a crash
 * between saves loses nothing. Keyed by agent, address and which draft: its id,
 * or for one not saved yet the mail it answers, or `new`.
 */
export const backupKeyOf = (
  agentId: string,
  accountId: string,
  slot: { draftId?: string } | { mode: AgentMailComposeMode; sourceMailId?: string },
) =>
  `lobe-agent-mail:draft:${agentId}:${accountId}:${
    'draftId' in slot && slot.draftId
      ? slot.draftId
      : 'mode' in slot && slot.sourceMailId
        ? `${slot.mode}:${slot.sourceMailId}`
        : 'new'
  }`;

export interface DraftBackup {
  excludedAttachments?: number[];
  fields: ComposeFields;
  /**
   * Holds something the server does not: edits not saved yet, or a malformed
   * address the server would refuse. Such a copy wins over the server's draft
   * on the next open. Whether it is newer is not a clock comparison: the
   * client's clock and the server's `updatedAt` need not agree, and resuming
   * an answer touches `updatedAt`.
   */
  pending: boolean;
  savedAt: number;
}

export const readBackup = (key: string): DraftBackup | undefined => {
  const raw = storage()?.getItem(key);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as DraftBackup;
    return parsed?.fields ? parsed : undefined;
  } catch {
    return undefined;
  }
};

export const writeBackup = (key: string, backup: DraftBackup) => {
  try {
    storage()?.setItem(key, JSON.stringify(backup));
  } catch {
    // A full storage only loses the extra copy; the server save still runs.
  }
};

export const clearBackup = (key: string) => storage()?.removeItem(key);

// --------------- Discards waiting out their undo ---------------

const pendingDiscards = new Map<string, () => void>();

/** A discarded draft is deleted after the undo window; until then this cancels it. */
export const holdDiscard = (id: string, cancel: () => void) => pendingDiscards.set(id, cancel);

export const releaseDiscard = (id: string) => pendingDiscards.delete(id);

/**
 * Keep a draft that is waiting to be deleted, because it was opened again
 * (answering the same mail again resumes the very draft just discarded).
 */
export const cancelPendingDiscard = (id: string) => {
  const cancel = pendingDiscards.get(id);
  if (!cancel) return false;
  pendingDiscards.delete(id);
  cancel();
  return true;
};
