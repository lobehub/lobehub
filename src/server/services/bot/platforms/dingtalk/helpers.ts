import crypto from 'node:crypto';

import type {
  DingTalkInboundMessagePayload,
  DingTalkDecryptedEvent,
  DingTalkNormalizedInboundMessage,
  DingTalkNormalizeOptions,
  DingTalkThreadId,
  DingTalkWebhookEncryptedResponse,
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

  // Avoid ASCII-centric `\b` word boundaries (Chinese bot names, emojis, etc.).
  // Only strip when "@botName" is followed by whitespace (or end-of-string).
  if (!leftTrimmed.startsWith('@')) return leftTrimmed;

  const nameCandidate = leftTrimmed.slice(1, 1 + botName.length);
  if (nameCandidate.toLowerCase() !== botName.toLowerCase()) return leftTrimmed;

  const after = leftTrimmed.slice(1 + botName.length);
  if (after && !/^[\s\u00A0]/u.test(after)) return leftTrimmed;

  return after.replace(/^[\s\u00A0]+/u, '');
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

const padBase64 = (input: string): string => {
  const mod = input.length % 4;
  if (mod === 0) return input;
  return input + '='.repeat(4 - mod);
};

const decodeAesKey = (aesKey: string): Buffer => {
  // DingTalk's encodingAESKey is typically 43 chars base64 (no padding).
  return Buffer.from(padBase64(aesKey), 'base64');
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
export const decryptDingTalkEventWithReceiver = (encrypt: string, aesKey: string): DingTalkDecryptedEvent => {
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

  const message = decrypted.subarray(start, end).toString('utf8');
  const receiverId = decrypted.subarray(end).toString('utf8');

  return { message, receiverId };
};

export const decryptDingTalkEvent = (encrypt: string, aesKey: string): string =>
  decryptDingTalkEventWithReceiver(encrypt, aesKey).message;

/**
 * Encrypt plaintext for DingTalk callbacks.
 *
 * DingTalk requires appending the owner/app key (receiverId) to the plaintext before encrypting.
 */
export const encryptDingTalkEvent = (plaintext: string, aesKey: string, receiverId: string): string => {
  const key = decodeAesKey(aesKey);
  const iv = key.subarray(0, 16);

  const random16 = crypto.randomBytes(16);
  const msg = Buffer.from(plaintext, 'utf8');
  const receiver = Buffer.from(receiverId, 'utf8');
  const msgLen = Buffer.alloc(4);
  msgLen.writeUInt32BE(msg.length, 0);

  const payload = Buffer.concat([random16, msgLen, msg, receiver]);

  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  cipher.setAutoPadding(true);

  return Buffer.concat([cipher.update(payload), cipher.final()]).toString('base64');
};

export const buildDingTalkEncryptedResponse = (params: {
  aesKey: string;
  nonce: string;
  receiverId: string;
  timestamp: string;
  token: string;
}): DingTalkWebhookEncryptedResponse => {
  const encrypt = encryptDingTalkEvent('success', params.aesKey, params.receiverId);

  return {
    encrypt,
    msg_signature: buildDingTalkWebhookSignature({
      encrypt,
      nonce: params.nonce,
      timestamp: params.timestamp,
      token: params.token,
    }),
    nonce: params.nonce,
    timeStamp: params.timestamp,
  };
};
