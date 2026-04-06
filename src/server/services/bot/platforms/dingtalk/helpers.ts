import crypto from 'node:crypto';

import type {
  DingTalkInboundMessagePayload,
  DingTalkNormalizedInboundMessage,
  DingTalkNormalizeOptions,
  DingTalkThreadId,
  DingTalkWebhookCryptoInput,
} from './types';

const THREAD_ID_PREFIX = 'dingtalk';

const DM_CONVERSATION_TYPES = new Set(['1', 'dm', 'p2p', 'single', 'private']);
const GROUP_CONVERSATION_TYPES = new Set(['2', 'group']);

const escapeRegExp = (input: string) => input.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const encodeDingTalkThreadId = (data: DingTalkThreadId): string =>
  `${THREAD_ID_PREFIX}:${data.type}:${data.id}`;

export const decodeDingTalkThreadId = (threadId: string): DingTalkThreadId => {
  const parts = threadId.split(':');
  if (parts.length < 3 || parts[0] !== THREAD_ID_PREFIX) {
    return { id: threadId, type: 'group' };
  }

  const type = parts[1] === 'dm' ? 'dm' : 'group';
  const id = parts.slice(2).join(':');

  return { id, type };
};

export const isDingTalkGroupThreadId = (threadId: string): boolean =>
  decodeDingTalkThreadId(threadId).type === 'group';

export const isDingTalkGroupPayload = (payload: DingTalkInboundMessagePayload): boolean => {
  const type = payload.conversationType;
  if (type && GROUP_CONVERSATION_TYPES.has(type)) return true;
  if (type && DM_CONVERSATION_TYPES.has(type)) return false;
  return false;
};

export const extractDingTalkText = (payload: DingTalkInboundMessagePayload): string => {
  const content = payload.text?.content;
  return typeof content === 'string' ? content : '';
};

export const isDingTalkBotMentioned = (payload: DingTalkInboundMessagePayload): boolean =>
  payload.isInAtList === true;

export const stripLeadingBotMention = (text: string, botName: string): string => {
  if (!text) return '';
  const leftTrimmed = text.replace(/^\s+/, '');
  if (!botName) return leftTrimmed;

  const pattern = new RegExp(`^@${escapeRegExp(botName)}\\b[\\s\\u00A0]*`, 'i');
  if (!pattern.test(leftTrimmed)) return leftTrimmed;

  return leftTrimmed.replace(pattern, '').replace(/^\s+/, '');
};

export const buildDingTalkThreadId = (payload: DingTalkInboundMessagePayload): string | null => {
  const conversationType = payload.conversationType;

  if (conversationType && DM_CONVERSATION_TYPES.has(conversationType)) {
    const id = payload.senderId || payload.conversationId;
    return id ? encodeDingTalkThreadId({ id, type: 'dm' }) : null;
  }

  if (conversationType && GROUP_CONVERSATION_TYPES.has(conversationType)) {
    const id = payload.conversationId;
    return id ? encodeDingTalkThreadId({ id, type: 'group' }) : null;
  }

  // Best-effort fallback for unexpected conversationType values.
  if (payload.conversationId) return encodeDingTalkThreadId({ id: payload.conversationId, type: 'group' });
  if (payload.senderId) return encodeDingTalkThreadId({ id: payload.senderId, type: 'dm' });

  return null;
};

export const normalizeDingTalkInboundMessage = (
  payload: DingTalkInboundMessagePayload,
  options: DingTalkNormalizeOptions,
): DingTalkNormalizedInboundMessage | null => {
  if (payload.msgtype !== 'text') return null;

  const rawText = extractDingTalkText(payload);
  if (!rawText.trim()) return null;

  const threadId = buildDingTalkThreadId(payload);
  if (!threadId) return null;

  const isGroup = isDingTalkGroupThreadId(threadId);
  const isMention = isDingTalkBotMentioned(payload);
  const requireMentionInGroup = options.requireMentionInGroup ?? true;

  if (isGroup && requireMentionInGroup && !isMention) return null;

  const stripBotMention = options.stripBotMention ?? true;
  const text =
    stripBotMention && options.botName && isMention
      ? stripLeadingBotMention(rawText, options.botName)
      : rawText.trim();

  return {
    authorId: payload.senderId || 'unknown',
    authorName: payload.senderNick,
    id: payload.msgId || '',
    isMention,
    raw: payload,
    text,
    threadId,
    timestamp: new Date(),
  };
};

// ---------------------------------------------------------------------
// Webhook crypto helpers (minimal; no network calls)
// ---------------------------------------------------------------------

export const buildDingTalkWebhookSignature = (input: DingTalkWebhookCryptoInput): string => {
  const pieces = [input.token, input.timestamp, input.nonce, input.encrypt].sort();
  return crypto.createHash('sha1').update(pieces.join(''), 'utf8').digest('hex');
};

export const verifyDingTalkWebhookSignature = (
  input: DingTalkWebhookCryptoInput & { signature: string },
): boolean => buildDingTalkWebhookSignature(input) === input.signature;

const decodeAesKey = (aesKey: string): Buffer => {
  // DingTalk's encodingAESKey is typically 43 chars base64 (no padding).
  const padded = aesKey.endsWith('=') ? aesKey : `${aesKey}=`;
  return Buffer.from(padded, 'base64');
};

/**
 * Decrypt DingTalk encrypted event payload (encrypt field).
 *
 * Payload format (common DingTalk scheme):
 *   16 bytes random
 *   4 bytes msg_len (big-endian)
 *   msg (utf8)
 *   corpId/appKey (utf8, trailing)
 */
export const decryptDingTalkEvent = (encrypt: string, aesKey: string): string => {
  const key = decodeAesKey(aesKey);
  const iv = key.subarray(0, 16);

  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  decipher.setAutoPadding(true);

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypt, 'base64')),
    decipher.final(),
  ]);

  if (decrypted.length < 20) throw new Error('Invalid decrypted payload');

  const msgLen = decrypted.readUInt32BE(16);
  const start = 20;
  const end = start + msgLen;
  if (end > decrypted.length) throw new Error('Invalid decrypted msg length');

  return decrypted.subarray(start, end).toString('utf8');
};

