import { ChatErrorType } from '@lobechat/types';
import { TRPCClientError } from '@trpc/client';
import { describe, expect, it } from 'vitest';

import { contactRequestOutcome, shareRefusalOf } from './shareRefusal';

const owner = { avatar: null, fullName: 'Ada', id: 'owner', username: 'ada' };

const detail = (
  job: { errorType: string | null; status: string },
  sharedAgentOwner: typeof owner | null = owner,
) =>
  ({
    jobs: [{ id: 'job', messageId: 'msg', ...job }],
    sharedAgentOwner,
  }) as never;

describe('shareRefusalOf', () => {
  // A visitor out of messages saw only a red dot, with the reason one click away and no way on.
  it('offers the owner as a contact when the limit is theirs', () => {
    expect(
      shareRefusalOf(
        detail({ errorType: ChatErrorType.ShareMessageLimitExceeded, status: 'failed' }),
        'msg',
      ),
    ).toEqual({ errorType: ChatErrorType.ShareMessageLimitExceeded, owner });
    expect(
      shareRefusalOf(
        detail({ errorType: ChatErrorType.ShareSpendLimitExceeded, status: 'failed' }),
        'msg',
      ),
    ).toEqual({ errorType: ChatErrorType.ShareSpendLimitExceeded, owner });
  });

  it('only explains a message that is too long, which the visitor fixes themselves', () => {
    expect(
      shareRefusalOf(
        detail({ errorType: ChatErrorType.SharePromptTooLong, status: 'failed' }),
        'msg',
      ),
    ).toEqual({ errorType: ChatErrorType.SharePromptTooLong });
  });

  it('leaves other failures, other messages and other conversations to the failure mark', () => {
    expect(
      shareRefusalOf(detail({ errorType: 'AgentRuntimeError', status: 'failed' }), 'msg'),
    ).toBeUndefined();
    expect(
      shareRefusalOf(
        detail({ errorType: ChatErrorType.ShareMessageLimitExceeded, status: 'failed' }),
        'other',
      ),
    ).toBeUndefined();
    expect(
      shareRefusalOf(
        detail({ errorType: ChatErrorType.ShareMessageLimitExceeded, status: 'failed' }, null),
        'msg',
      ),
    ).toBeUndefined();
  });
});

describe('contactRequestOutcome', () => {
  it('reads an accepted or pending request', () => {
    expect(contactRequestOutcome({ result: { status: 'accepted' } })).toBe('added');
    expect(contactRequestOutcome({ result: { status: 'pending' } })).toBe('requestSent');
  });

  it('treats a conflict as already reaching the owner, and anything else as an error', () => {
    expect(
      contactRequestOutcome({
        error: new TRPCClientError('Already a contact', {
          result: { error: { data: { code: 'CONFLICT' } } },
        } as any),
      }),
    ).toBe('alreadyContact');
    expect(contactRequestOutcome({ error: new Error('network') })).toBeUndefined();
  });
});
