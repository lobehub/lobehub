import { ChatErrorType } from '@lobechat/types';
import { TRPCClientError } from '@trpc/client';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { resolveVisitorErrorKey } from './resolveVisitorErrorKey';

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

  it('does not treat a non-BAD_REQUEST TRPCClientError as a prompt-length rejection', () => {
    const error = new TRPCClientError('Not found', {
      result: { error: { code: -32_600, data: { code: 'NOT_FOUND' }, message: 'Not Found' } },
    });

    expect(resolveVisitorErrorKey(error)).toBe('share.visitor.errors.generic');
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
