import type { LinqInboundMessage } from '@lobechat/agent-address-linq';
import { normalizeLinqNumber } from '@lobechat/agent-address-linq';

/**
 * The stable platform user id for a Linq sender. Phone handles normalize to
 * E.164 so `+1 (555) 000-2222` and `+15550002222` are one person; iMessage
 * handles can also be an Apple ID email, which is lower-cased instead.
 */
export const normalizeLinqHandle = (raw: string | undefined | null): string | undefined => {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes('@')) return trimmed.toLowerCase();
  return normalizeLinqNumber(trimmed);
};

/** The human's handle, across the shapes Linq serializes a sender in. */
export const linqSenderHandle = (data: LinqInboundMessage): string | undefined => {
  const raw =
    data.sender_handle?.handle ??
    (typeof data.sender === 'string' ? data.sender : data.sender?.handle);
  return normalizeLinqHandle(raw);
};
