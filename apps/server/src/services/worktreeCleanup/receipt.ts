import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import type { OwnedWorktree } from '@lobechat/types';

/**
 * Creation receipts for the worktrees the app makes for a conversation.
 *
 * The device stores a token in the worktree's git admin dir and acts on the
 * worktree only for a matching token (`ownerMarker.ts` in local-file-shell).
 * Topic metadata is readable by everyone who can open the topic, so the token
 * alone proves nothing: the server issues it as an HMAC over the creator's
 * user id and a nonce, and presents a record's token to a device only when it
 * re-derives from the claiming topic's own creator. A token copied into
 * another member's topic never verifies there.
 */

const DOMAIN = 'lobehub:owned-worktree:v1';

const secret = () => process.env.KEY_VAULTS_SECRET?.trim() || undefined;

const sign = (key: string, userId: string, nonce: string) =>
  createHmac('sha256', key).update(`${DOMAIN}:${userId}:${nonce}`).digest('base64url');

export interface WorktreeReceipt {
  nonce: string;
  token: string;
}

/** A receipt for a worktree `userId` is about to create; `undefined` without a server secret. */
export const issueWorktreeReceipt = (userId: string): WorktreeReceipt | undefined => {
  const key = secret();
  if (!key) return undefined;
  const nonce = randomUUID();
  return { nonce, token: sign(key, userId, nonce) };
};

/**
 * The record's token, when it was issued to the topic's creator; otherwise
 * `undefined`, so a device holding a receipt refuses the request.
 */
export const attestedOwnerToken = (
  topicUserId: string,
  entry: Pick<OwnedWorktree, 'ownerNonce' | 'ownerToken'>,
): string | undefined => {
  const key = secret();
  const { ownerNonce, ownerToken } = entry;
  if (!key || !ownerNonce || !ownerToken) return undefined;
  const expected = Buffer.from(sign(key, topicUserId, ownerNonce));
  const actual = Buffer.from(ownerToken);
  return expected.length === actual.length && timingSafeEqual(expected, actual)
    ? ownerToken
    : undefined;
};
