import { ChatErrorType } from '@lobechat/types';
import { TRPCClientError } from '@trpc/client';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { isTerminalVisitorError, resolveVisitorErrorKey } from './resolveVisitorErrorKey';

describe('resolveVisitorErrorKey', () => {
  /**
   * The lambda router installs no `zodError` formatter, so tRPC surfaces the
   * ZodError's own `message` — `JSON.stringify(issues, null, 2)`. Build the
   * fixtures from a real schema rejection so the mapping is tested against the
   * shape production actually produces, not a hand-written string.
   */
  const badRequest = (message: string) =>
    new TRPCClientError(message, {
      result: { error: { code: -32_600, data: { code: 'BAD_REQUEST' }, message: 'Bad Request' } },
    });

  const zodMessage = (schema: z.ZodTypeAny, value: unknown) => {
    const parsed = z.object({ payload: schema }).safeParse({ payload: value });
    if (parsed.success) throw new Error('fixture should have failed validation');
    return parsed.error.message;
  };

  it('maps a BAD_REQUEST TRPCClientError (over-long prompt) to actionable copy', () => {
    const message = zodMessage(z.string().max(3), 'way too long').replace('payload', 'prompt');

    expect(resolveVisitorErrorKey(badRequest(message))).toBe('share.visitor.errors.promptTooLong');
  });

  it('does not blame prompt length for an unrelated BAD_REQUEST on another field', () => {
    // A malformed `clientIds.topicId` also fails the schema — telling the
    // visitor to shorten their message would be actively misleading.
    const message = zodMessage(z.string().regex(/^topic_/), 'nope').replace('payload', 'topicId');

    expect(resolveVisitorErrorKey(badRequest(message))).toBe('share.visitor.errors.generic');
  });

  const trpcError = (code: string, message = code) =>
    new TRPCClientError(message, {
      result: { error: { code: -32_600, data: { code }, message } },
    });

  it('maps a FORBIDDEN send to the paused-share copy instead of a retryable failure', () => {
    // The creator flipped visibility away from `link` mid-session:
    // `resolveLinkShareOrThrow` rejects every further send, so retrying is futile.
    expect(resolveVisitorErrorKey(trpcError('FORBIDDEN', 'This share is private'))).toBe(
      'share.visitor.errors.sharingPaused',
    );
  });

  it('maps a topic-level NOT_FOUND send to the recoverable unavailable copy', () => {
    expect(resolveVisitorErrorKey(trpcError('NOT_FOUND', 'Topic not found'))).toBe(
      'share.visitor.errors.unavailable',
    );
  });

  it('maps a share-level NOT_FOUND send to the paused-share copy', () => {
    // A paused share answers NOT_FOUND to a stranger (no existence probing),
    // which for a visitor mid-session means the same as "sharing paused".
    expect(resolveVisitorErrorKey(trpcError('NOT_FOUND', 'Share not found'))).toBe(
      'share.visitor.errors.sharingPaused',
    );
  });

  it('treats share-level failures as terminal and per-attempt ones as retryable', () => {
    expect(isTerminalVisitorError('share.visitor.errors.sharingPaused')).toBe(true);
    // NOT_FOUND may describe only the current topic (deleted topic), which a
    // topic switch / new conversation recovers from — locking the composer on
    // it would strand the visitor with no way out but a reload.
    expect(isTerminalVisitorError('share.visitor.errors.unavailable')).toBe(false);
    // The turn limit is scoped to one topic — a new conversation clears it.
    expect(isTerminalVisitorError('share.visitor.errors.turnLimit')).toBe(false);
    expect(isTerminalVisitorError('share.visitor.errors.generic')).toBe(false);
  });

  it('maps ShareTurnLimitExceeded', () => {
    expect(resolveVisitorErrorKey(new Error(ChatErrorType.ShareTurnLimitExceeded))).toBe(
      'share.visitor.errors.turnLimit',
    );
  });

  it('maps ShareTopicLimitExceeded', () => {
    expect(resolveVisitorErrorKey(new Error(ChatErrorType.ShareTopicLimitExceeded))).toBe(
      'share.visitor.errors.topicLimit',
    );
  });

  it('maps ShareSpendLimitExceeded to non-terminal "monthly limit reached" copy', () => {
    expect(resolveVisitorErrorKey(new Error(ChatErrorType.ShareSpendLimitExceeded))).toBe(
      'share.visitor.errors.spendLimit',
    );
    // The cap resets next month and the owner can raise it — keep the composer usable.
    expect(isTerminalVisitorError('share.visitor.errors.spendLimit')).toBe(false);
  });

  it('maps InsufficientBudgetForModel', () => {
    expect(resolveVisitorErrorKey(new Error(ChatErrorType.InsufficientBudgetForModel))).toBe(
      'share.visitor.errors.insufficientBudget',
    );
  });

  it('maps AgentShareProviderNotSupported', () => {
    expect(resolveVisitorErrorKey(new Error(ChatErrorType.AgentShareProviderNotSupported))).toBe(
      'share.visitor.errors.providerNotSupported',
    );
  });

  it('maps ShareHeterogeneousAgentUnsupported', () => {
    expect(
      resolveVisitorErrorKey(new Error(ChatErrorType.ShareHeterogeneousAgentUnsupported)),
    ).toBe('share.visitor.errors.heterogeneousUnsupported');
  });

  it('falls back to the generic copy for an unrecognized error', () => {
    expect(resolveVisitorErrorKey(new Error('boom'))).toBe('share.visitor.errors.generic');
  });

  it('falls back to the generic copy for a non-Error thrown value', () => {
    expect(resolveVisitorErrorKey('boom')).toBe('share.visitor.errors.generic');
  });
});
