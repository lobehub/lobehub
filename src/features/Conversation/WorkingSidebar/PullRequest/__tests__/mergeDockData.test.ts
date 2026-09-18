import type { DeviceGitPullRequestDetail } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { type MergeDockInput, PR_KEYS, resolveMergeDock } from '../mergeDockData';

const makeDetail = (
  overrides: Partial<DeviceGitPullRequestDetail> = {},
): DeviceGitPullRequestDetail => ({
  additions: 10,
  author: 'innei',
  autoMerge: null,
  baseBehindBy: 0,
  baseRefName: 'main',
  body: '',
  changedFiles: 2,
  checks: [{ name: 'ci', required: true, status: 'success' }],
  comments: [],
  commits: [{ author: 'innei', committedAt: '2026-09-13T00:00:00Z', message: 'fix', sha: 'abc' }],
  deletions: 2,
  headRefName: 'feat/x',
  headRefOid: 'a'.repeat(40),
  isCrossRepository: false,
  isDraft: false,
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
  number: 1,
  repo: { name: 'lobe-chat', owner: 'lobehub' },
  reviewDecision: 'APPROVED',
  reviews: [{ author: 'foo', state: 'APPROVED', submittedAt: '2026-09-13T00:00:00Z' }],
  state: 'open',
  title: 'PR',
  url: 'https://github.com/lobehub/lobe-chat/pull/1',
  viewerCanBypass: false,
  viewerCanWrite: true,
  ...overrides,
});

const makeInput = (overrides: Partial<MergeDockInput> = {}): MergeDockInput => ({
  detail: makeDetail(),
  ui: { bypass: false, method: 'squash' },
  ...overrides,
});

const reasonKeys = (result: ReturnType<typeof resolveMergeDock>) =>
  result.reasons.map((reason) => reason.labelKey);

describe('resolveMergeDock', () => {
  it('clean: ready status, green merge action, merge hint', () => {
    const result = resolveMergeDock(makeInput());
    expect(result.status).toMatchObject({ key: 'ready', tone: 'success' });
    expect(result.reasons).toEqual([]);
    expect(result.action).toEqual({
      admin: false,
      kind: 'merge',
      method: 'squash',
      tone: 'success',
    });
    expect(result.bypassAvailable).toBe(false);
    expect(result.hintKey).toBe(PR_KEYS.hint.merge);
  });

  it('pending: required check pending under BLOCKED waits and offers auto-merge', () => {
    const result = resolveMergeDock(
      makeInput({
        detail: makeDetail({
          checks: [{ name: 'ci', required: true, status: 'pending' }],
          mergeStateStatus: 'BLOCKED',
        }),
      }),
    );
    expect(result.checksStatus).toBe('pending');
    expect(result.status).toMatchObject({ key: 'waiting', tone: 'warning' });
    expect(reasonKeys(result)).toEqual([PR_KEYS.reason.checksPending]);
    expect(result.action).toEqual({ kind: 'autoMerge', method: 'squash', tone: 'plain' });
    expect(result.hintKey).toBeUndefined();
  });

  it('pendingUnprotected: mergeable while checks run turns the merge action amber', () => {
    const result = resolveMergeDock(
      makeInput({
        detail: makeDetail({ checks: [{ name: 'ci', required: false, status: 'pending' }] }),
      }),
    );
    expect(result.status.key).toBe('waiting');
    expect(result.action).toEqual({
      admin: false,
      kind: 'merge',
      method: 'squash',
      tone: 'plain',
    });
  });

  it('unstable: optional check failing warns but still allows merging', () => {
    const result = resolveMergeDock(
      makeInput({
        detail: makeDetail({
          checks: [
            { name: 'ci', required: true, status: 'success' },
            { name: 'verify', required: false, status: 'failure' },
          ],
        }),
      }),
    );
    expect(result.status).toMatchObject({ key: 'unstable', tone: 'warning' });
    expect(result.reasons).toEqual([
      { labelKey: PR_KEYS.reason.optionalFailing, labelParams: { count: 1 } },
    ]);
    expect(result.action).toMatchObject({ kind: 'merge', tone: 'plain' });
  });

  it('autoMerge: armed status with method and a disabled waiting action', () => {
    const result = resolveMergeDock(
      makeInput({
        detail: makeDetail({
          autoMerge: { method: 'squash' },
          checks: [{ name: 'ci', required: true, status: 'pending' }],
          mergeStateStatus: 'BLOCKED',
        }),
      }),
    );
    expect(result.status).toMatchObject({
      key: 'autoMerge',
      labelParams: { method: 'squash' },
      tone: 'merged',
    });
    expect(result.action).toEqual({ kind: 'disabled', labelKey: PR_KEYS.action.waiting });
  });

  it('ciFailed: blocked status lists the failing count and disables the action', () => {
    const result = resolveMergeDock(
      makeInput({
        detail: makeDetail({
          checks: [
            { name: 'ci', required: true, status: 'failure' },
            { name: 'lint', required: true, status: 'cancelled' },
          ],
          mergeStateStatus: 'BLOCKED',
        }),
      }),
    );
    expect(result.checksStatus).toBe('failure');
    expect(result.status).toMatchObject({ key: 'blocked', tone: 'error' });
    expect(result.reasons).toEqual([
      { labelKey: PR_KEYS.reason.checksFailing, labelParams: { count: 2 } },
    ]);
    expect(result.action).toEqual({ kind: 'disabled', labelKey: PR_KEYS.method.squash });
    expect(result.bypassAvailable).toBe(false);
    expect(result.hintKey).toBeUndefined();
  });

  it('ciFailed+bypass: bypass status keeps the blockers listed and merges with --admin', () => {
    const result = resolveMergeDock(
      makeInput({
        detail: makeDetail({
          checks: [{ name: 'ci', required: true, status: 'failure' }],
          mergeStateStatus: 'BLOCKED',
          viewerCanBypass: true,
        }),
        ui: { bypass: true, method: 'squash' },
      }),
    );
    expect(result.status).toMatchObject({ key: 'bypass', tone: 'error' });
    expect(reasonKeys(result)).toEqual([PR_KEYS.reason.checksFailing]);
    expect(result.action).toEqual({ admin: true, kind: 'merge', method: 'squash', tone: 'error' });
    expect(result.bypassAvailable).toBe(true);
  });

  it('blockedByRules: BLOCKED with nothing else failing names the branch rules', () => {
    const result = resolveMergeDock(
      makeInput({ detail: makeDetail({ mergeStateStatus: 'BLOCKED' }) }),
    );
    expect(result.status.key).toBe('blocked');
    expect(reasonKeys(result)).toEqual([PR_KEYS.reason.rules]);
  });

  it('reviewRequired: blocked with a review reason', () => {
    const result = resolveMergeDock(
      makeInput({ detail: makeDetail({ reviewDecision: 'REVIEW_REQUIRED' }) }),
    );
    expect(result.status.key).toBe('blocked');
    expect(reasonKeys(result)).toEqual([PR_KEYS.reason.reviewRequired]);
  });

  it('changesRequested: reason lists the requesting authors', () => {
    const result = resolveMergeDock(
      makeInput({
        detail: makeDetail({
          reviewDecision: 'CHANGES_REQUESTED',
          reviews: [
            { author: 'foo', state: 'CHANGES_REQUESTED', submittedAt: '2026-09-13T00:00:00Z' },
            { author: 'bar', state: 'CHANGES_REQUESTED', submittedAt: '2026-09-13T00:00:00Z' },
          ],
        }),
      }),
    );
    expect(result.status.key).toBe('blocked');
    expect(result.reasons).toEqual([
      { labelKey: PR_KEYS.reason.changesRequested, labelParams: { authors: 'foo, bar' } },
    ]);
  });

  it('multipleBlockers: reasons are ordered checks → review → base', () => {
    const result = resolveMergeDock(
      makeInput({
        detail: makeDetail({
          checks: [{ name: 'ci', required: true, status: 'failure' }],
          mergeStateStatus: 'BLOCKED',
          reviewDecision: 'REVIEW_REQUIRED',
        }),
        local: { ahead: 1, dirtyFiles: 0 },
      }),
    );
    expect(reasonKeys(result)).toEqual([
      PR_KEYS.reason.checksFailing,
      PR_KEYS.reason.reviewRequired,
      PR_KEYS.reason.localAhead,
    ]);
  });

  it('conflicts: conflict status names the base and disables the action', () => {
    const result = resolveMergeDock(
      makeInput({ detail: makeDetail({ mergeable: 'CONFLICTING' }) }),
    );
    expect(result.status).toMatchObject({
      icon: 'conflict',
      key: 'conflicts',
      labelParams: { base: 'main' },
      tone: 'error',
    });
    expect(result.reasons).toEqual([]);
    expect(result.action).toEqual({ kind: 'disabled', labelKey: PR_KEYS.action.conflicting });
  });

  it('behind: blocked with a behind reason and an updateBranch action', () => {
    const result = resolveMergeDock(
      makeInput({ detail: makeDetail({ mergeStateStatus: 'BEHIND' }) }),
    );
    expect(result.status.key).toBe('blocked');
    expect(result.reasons).toEqual([
      { labelKey: PR_KEYS.reason.behind, labelParams: { base: 'main' } },
    ]);
    expect(result.action).toEqual({ kind: 'updateBranch', tone: 'success' });
  });

  it('behindUnprotected: base moved ahead without BEHIND offers Update branch beside merge', () => {
    const result = resolveMergeDock(makeInput({ detail: makeDetail({ baseBehindBy: 3 }) }));
    expect(result.action).toMatchObject({ kind: 'merge' });
    expect(result.showUpdateBranch).toBe(true);
  });

  it('behindProtected: BEHIND promotes Update branch to the primary action only', () => {
    const result = resolveMergeDock(
      makeInput({ detail: makeDetail({ baseBehindBy: 3, mergeStateStatus: 'BEHIND' }) }),
    );
    expect(result.action).toEqual({ kind: 'updateBranch', tone: 'success' });
    expect(result.showUpdateBranch).toBe(false);
  });

  it('draft: neutral draft status, no reasons, ready action', () => {
    const result = resolveMergeDock(makeInput({ detail: makeDetail({ isDraft: true }) }));
    expect(result.status).toMatchObject({ key: 'draft', tone: 'neutral' });
    expect(result.reasons).toEqual([]);
    expect(result.action).toEqual({ kind: 'ready' });
    expect(result.bypassAvailable).toBe(false);
  });

  it('merged: merged-tone status and deleteBranch action', () => {
    const result = resolveMergeDock(makeInput({ detail: makeDetail({ state: 'merged' }) }));
    expect(result.status).toMatchObject({ key: 'merged', tone: 'merged' });
    expect(result.action).toEqual({ kind: 'deleteBranch' });
    expect(result.hintKey).toBe(PR_KEYS.hint.merged);
    expect(result.hintParams).toEqual({ head: 'feat/x' });
  });

  it('merged+fork: no deleteBranch action offered for a cross-repository PR', () => {
    const result = resolveMergeDock(
      makeInput({ detail: makeDetail({ isCrossRepository: true, state: 'merged' }) }),
    );
    expect(result.action).toBeUndefined();
    expect(result.hintKey).toBe(PR_KEYS.hint.merged);
  });

  it('merged+readOnly: still shows the merged hint, not the readOnly hint', () => {
    const result = resolveMergeDock(
      makeInput({ detail: makeDetail({ state: 'merged', viewerCanWrite: false }) }),
    );
    expect(result.action).toBeUndefined();
    expect(result.hintKey).toBe(PR_KEYS.hint.merged);
  });

  it('closed: error-tone status and reopen action', () => {
    const result = resolveMergeDock(makeInput({ detail: makeDetail({ state: 'closed' }) }));
    expect(result.status).toMatchObject({ key: 'closed', tone: 'error' });
    expect(result.action).toEqual({ kind: 'reopen' });
  });

  it('unpushed: local reasons replace the hint and push pairs with the merge action', () => {
    const result = resolveMergeDock(makeInput({ local: { ahead: 2, dirtyFiles: 3 } }));
    expect(result.status.key).toBe('ready');
    expect(result.reasons).toEqual([
      { labelKey: PR_KEYS.reason.localAhead, labelParams: { count: 2 } },
      { labelKey: PR_KEYS.reason.localDirty, labelParams: { count: 3 } },
    ]);
    expect(result.showPush).toBe(true);
    expect(result.hintKey).toBeUndefined();
  });

  it('readOnly: no action, no bypass, and the readOnly hint survives reasons', () => {
    const result = resolveMergeDock(
      makeInput({
        detail: makeDetail({ reviewDecision: 'REVIEW_REQUIRED', viewerCanWrite: false }),
      }),
    );
    expect(result.action).toBeUndefined();
    expect(result.bypassAvailable).toBe(false);
    expect(reasonKeys(result)).toEqual([PR_KEYS.reason.reviewRequired]);
    expect(result.hintKey).toBe(PR_KEYS.hint.readOnly);
    expect(result.hintParams).toEqual({ repo: 'lobehub/lobe-chat' });
  });

  it('unknown: UNKNOWN mergeability shows a spinner status and disables the action', () => {
    const result = resolveMergeDock(makeInput({ detail: makeDetail({ mergeable: 'UNKNOWN' }) }));
    expect(result.status).toMatchObject({ icon: 'spinner', key: 'calculating' });
    expect(result.reasons).toEqual([]);
    expect(result.action).toEqual({ kind: 'disabled', labelKey: PR_KEYS.action.calculating });
    expect(result.hintKey).toBe(PR_KEYS.hint.calculating);
  });

  it('actionError: error status carries the message and clears the hint', () => {
    const result = resolveMergeDock(
      makeInput({ ui: { bypass: false, error: 'gh: failed', method: 'squash' } }),
    );
    expect(result.status).toMatchObject({
      key: 'error',
      labelParams: { message: 'gh: failed' },
      tone: 'error',
    });
    expect(result.hintKey).toBeUndefined();
    expect(result.action).toEqual({
      admin: false,
      kind: 'merge',
      method: 'squash',
      tone: 'success',
    });
  });

  it('contextLoading: disables the action without flashing the readOnly hint', () => {
    const result = resolveMergeDock(
      makeInput({
        detail: makeDetail({ viewerCanBypass: false, viewerCanWrite: false }),
        ui: { bypass: false, contextLoading: true, method: 'squash' },
      }),
    );
    expect(result.status.key).toBe('ready');
    expect(result.action).toEqual({ kind: 'disabled', labelKey: PR_KEYS.action.calculating });
    expect(result.hintKey).toBeUndefined();
    expect(result.bypassAvailable).toBe(false);
  });

  it('busy: keeps the action kind/tone and attaches a busyLabelKey', () => {
    const result = resolveMergeDock(
      makeInput({ ui: { busy: 'merge', bypass: false, method: 'squash' } }),
    );
    expect(result.action).toEqual({
      admin: false,
      busy: true,
      busyLabelKey: PR_KEYS.action.merging,
      kind: 'merge',
      method: 'squash',
      tone: 'success',
    });
  });
});
