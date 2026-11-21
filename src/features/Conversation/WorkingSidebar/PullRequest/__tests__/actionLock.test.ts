import { describe, expect, it } from 'vitest';

import { resolvePullRequestActionLock } from '../actionLock';

const context = {
  baseBehindBy: 0,
  requiredChecks: ['ci'],
  viewerCanBypass: true,
  viewerCanWrite: true,
};
const live = {
  confirmed: true,
  context,
  contextConfirmed: true,
  contextError: undefined,
  detailConfirmed: true,
  detailError: undefined,
};

describe('resolvePullRequestActionLock', () => {
  it('unlocks once the PR and its merge context are live', () => {
    expect(resolvePullRequestActionLock(live)).toEqual({
      context,
      contextLoading: false,
      locked: false,
      policyLocked: false,
      refreshFailed: false,
    });
  });

  it('locks every action until the PR itself is confirmed', () => {
    expect(resolvePullRequestActionLock({ ...live, confirmed: false }).locked).toBe(true);
    expect(resolvePullRequestActionLock({ ...live, detailConfirmed: false }).locked).toBe(true);
  });

  // Regression: a persisted merge context hydrated before its live read, so
  // merge / update / bypass / base change unlocked on last session's policy.
  it('paints a persisted merge context but locks policy actions until it is live', () => {
    expect(resolvePullRequestActionLock({ ...live, contextConfirmed: false })).toEqual({
      context,
      contextLoading: true,
      locked: false,
      policyLocked: true,
      refreshFailed: false,
    });
  });

  it('drops the persisted policy instead of locking forever when the live read fails', () => {
    expect(
      resolvePullRequestActionLock({
        ...live,
        contextConfirmed: false,
        contextError: new Error('gh failed'),
      }),
    ).toEqual({
      context: undefined,
      contextLoading: false,
      locked: false,
      policyLocked: false,
      refreshFailed: true,
    });
  });

  it('reports the merge context as loading only while its read is in flight', () => {
    expect(
      resolvePullRequestActionLock({
        ...live,
        context: undefined,
        contextConfirmed: false,
      }).contextLoading,
    ).toBe(true);
  });

  // Regression: a failed refresh of a persisted detail kept every action locked
  // with no error and no retry, since the error row only rendered without detail.
  it('flags a failed live detail read while the persisted detail still paints', () => {
    const result = resolvePullRequestActionLock({
      ...live,
      detailConfirmed: false,
      detailError: new Error('gh failed'),
    });
    expect(result.locked).toBe(true);
    expect(result.refreshFailed).toBe(true);
  });

  it('does not flag a failed refresh once the read was confirmed this session', () => {
    expect(
      resolvePullRequestActionLock({
        ...live,
        contextError: new Error('gh failed'),
        detailError: new Error('gh failed'),
      }).refreshFailed,
    ).toBe(false);
  });

  it('keeps a confirmed context through a later failed refresh', () => {
    expect(
      resolvePullRequestActionLock({ ...live, contextError: new Error('gh failed') }).context,
    ).toBe(context);
  });

  it('flags a failed confirmation read that keeps the PR locked', () => {
    const result = resolvePullRequestActionLock({
      ...live,
      confirmError: new Error('device offline'),
      confirmed: false,
    });
    expect(result.locked).toBe(true);
    expect(result.refreshFailed).toBe(true);
  });
});
