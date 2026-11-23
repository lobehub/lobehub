import { ChatErrorType } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { shareRefusalOf, withoutShareRefusals } from './shareRefusal';

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

  // A visitor refused a local Agent was told to ask its creator, with no way to reach them.
  it('offers the owner as a contact when their machine needs their permission', () => {
    expect(
      shareRefusalOf(
        detail({ errorType: ChatErrorType.ShareHeterogeneousAgentUnsupported, status: 'failed' }),
        'msg',
      ),
    ).toEqual({ errorType: ChatErrorType.ShareHeterogeneousAgentUnsupported, owner });
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

describe('withoutShareRefusals', () => {
  const refused = {
    errorType: ChatErrorType.ShareMessageLimitExceeded,
    id: 'refused',
    status: 'failed',
  };
  const crashed = { errorType: 'AgentRuntimeError', id: 'crashed', status: 'failed' };

  // A refused reply read both below the visitor's message and again as a failure card.
  it("leaves a shared Agent's refusals to the notice below the request", () => {
    expect(withoutShareRefusals({ sharedAgentOwner: owner }, [refused, crashed])).toEqual([
      crashed,
    ]);
  });

  it('keeps every failure card in other conversations', () => {
    expect(withoutShareRefusals({ sharedAgentOwner: null }, [refused, crashed])).toEqual([
      refused,
      crashed,
    ]);
  });
});
