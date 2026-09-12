import type { DeviceGitPullRequestDetail } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { type MergeDockInput, PR_KEYS, resolveMergeDock } from '../mergeDockData';

const makeDetail = (
  overrides: Partial<DeviceGitPullRequestDetail> = {},
): DeviceGitPullRequestDetail => ({
  additions: 10,
  author: 'innei',
  autoMerge: null,
  baseRefName: 'main',
  body: '',
  changedFiles: 2,
  checks: [{ name: 'ci', required: true, status: 'success' }],
  comments: [],
  commits: [{ author: 'innei', committedAt: '2026-09-13T00:00:00Z', message: 'fix', sha: 'abc' }],
  deletions: 2,
  headRefName: 'feat/x',
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

const rowKeys = (result: ReturnType<typeof resolveMergeDock>) => result.rows.map((row) => row.key);
const rowTones = (result: ReturnType<typeof resolveMergeDock>) =>
  result.rows.map((row) => row.tone);

describe('resolveMergeDock', () => {
  it('clean: green merge action, ready rules row', () => {
    const result = resolveMergeDock(makeInput());
    expect(rowKeys(result)).toEqual(['review', 'checks', 'base', 'rules']);
    expect(rowTones(result)).toEqual(['success', 'success', 'success', 'success']);
    expect(result.action).toEqual({
      admin: false,
      kind: 'merge',
      method: 'squash',
      tone: 'success',
    });
    expect(result.showBypass).toBe(false);
    expect(result.hintKey).toBe(PR_KEYS.hint.merge);
  });

  it('pending: required check pending under BLOCKED offers auto-merge', () => {
    const result = resolveMergeDock(
      makeInput({
        detail: makeDetail({
          checks: [{ name: 'ci', required: true, status: 'pending' }],
          mergeStateStatus: 'BLOCKED',
        }),
      }),
    );
    expect(result.checksStatus).toBe('pending');
    expect(result.action).toEqual({ kind: 'autoMerge', method: 'squash', tone: 'warning' });
    expect(result.hintKey).toBeUndefined();
  });

  it('autoMerge: already armed shows the row and a disabled waiting action', () => {
    const result = resolveMergeDock(
      makeInput({
        detail: makeDetail({
          autoMerge: { method: 'squash' },
          checks: [{ name: 'ci', required: true, status: 'pending' }],
          mergeStateStatus: 'BLOCKED',
        }),
      }),
    );
    expect(rowKeys(result)).toEqual(['autoMerge', 'review', 'checks', 'base', 'rules']);
    expect(result.action).toEqual({ kind: 'disabled', labelKey: PR_KEYS.action.waiting });
    expect(result.hintKey).toBe(PR_KEYS.hint.autoMerge);
    expect(result.hintParams).toEqual({ method: 'squash' });
  });

  it('ciFailed: required check failing disables the action', () => {
    const result = resolveMergeDock(
      makeInput({
        detail: makeDetail({
          checks: [{ name: 'ci', required: true, status: 'failure' }],
          mergeStateStatus: 'BLOCKED',
        }),
      }),
    );
    expect(result.checksStatus).toBe('failure');
    expect(result.action).toEqual({ kind: 'disabled', labelKey: PR_KEYS.method.squash });
    expect(result.showBypass).toBe(false);
  });

  it('ciFailed+bypass: viewerCanBypass with bypass ticked merges with --admin', () => {
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
    expect(result.action).toEqual({ admin: true, kind: 'merge', method: 'squash', tone: 'error' });
    expect(result.showBypass).toBe(true);
    expect(result.hintKey).toBe(PR_KEYS.hint.bypass);
    const rules = result.rows.find((row) => row.key === 'rules')!;
    expect(rules.tone).toBe('error');
    expect(rules.trailingKey).toBeUndefined();
  });

  it('reviewRequired: red review row with 0 of 1 trailing', () => {
    const result = resolveMergeDock(
      makeInput({ detail: makeDetail({ reviewDecision: 'REVIEW_REQUIRED' }) }),
    );
    const review = result.rows.find((row) => row.key === 'review')!;
    expect(review.tone).toBe('error');
    expect(review.trailingKey).toBe(PR_KEYS.row.review.trailingCount);
    expect(review.trailingParams).toEqual({ approved: 0, required: 1 });
  });

  it('changesRequested: red review row lists requesting authors', () => {
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
    const review = result.rows.find((row) => row.key === 'review')!;
    expect(review.tone).toBe('error');
    expect(review.trailingParams).toEqual({ authors: 'foo, bar' });
  });

  it('conflicts: CONFLICTING disables the action and errors the base row', () => {
    const result = resolveMergeDock(
      makeInput({ detail: makeDetail({ mergeable: 'CONFLICTING' }) }),
    );
    const base = result.rows.find((row) => row.key === 'base')!;
    expect(base.tone).toBe('error');
    expect(base.icon).toBe('conflict');
    expect(result.action).toEqual({ kind: 'disabled', labelKey: PR_KEYS.action.conflicting });
  });

  it('behind: offers updateBranch and omits a trailing commit count', () => {
    const result = resolveMergeDock(
      makeInput({ detail: makeDetail({ mergeStateStatus: 'BEHIND' }) }),
    );
    const base = result.rows.find((row) => row.key === 'base')!;
    expect(base.tone).toBe('warning');
    expect(base.trailingKey).toBeUndefined();
    expect(result.action).toEqual({ kind: 'updateBranch', tone: 'success' });
  });

  it('draft: single neutral state row plus checks, ready action', () => {
    const result = resolveMergeDock(makeInput({ detail: makeDetail({ isDraft: true }) }));
    expect(rowKeys(result)).toEqual(['base', 'checks']);
    expect(result.rows[0].tone).toBe('neutral');
    expect(result.action).toEqual({ kind: 'ready' });
    expect(result.showBypass).toBe(false);
  });

  it('merged: single merged-tone row and deleteBranch action', () => {
    const result = resolveMergeDock(makeInput({ detail: makeDetail({ state: 'merged' }) }));
    expect(rowKeys(result)).toEqual(['base']);
    expect(result.rows[0].tone).toBe('merged');
    expect(result.action).toEqual({ kind: 'deleteBranch' });
    expect(result.hintKey).toBe(PR_KEYS.hint.merged);
    expect(result.hintParams).toEqual({ head: 'feat/x' });
  });

  it('closed: single error-tone row and reopen action', () => {
    const result = resolveMergeDock(makeInput({ detail: makeDetail({ state: 'closed' }) }));
    expect(rowKeys(result)).toEqual(['base']);
    expect(result.rows[0].tone).toBe('error');
    expect(result.action).toEqual({ kind: 'reopen' });
  });

  it('unpushed: local-ahead row shows and push button pairs with the merge action', () => {
    const result = resolveMergeDock(makeInput({ local: { ahead: 2, dirtyFiles: 0 } }));
    expect(rowKeys(result)).toEqual(['review', 'checks', 'base', 'local', 'rules']);
    expect(result.showPush).toBe(true);
    expect(result.hintKey).toBe(PR_KEYS.hint.localAhead);
    expect(result.hintParams).toEqual({ count: 2 });
  });

  it('readOnly: no action, no bypass, and a readOnly hint naming the repo', () => {
    const result = resolveMergeDock(makeInput({ detail: makeDetail({ viewerCanWrite: false }) }));
    expect(result.action).toBeUndefined();
    expect(result.showBypass).toBe(false);
    expect(result.hintKey).toBe(PR_KEYS.hint.readOnly);
    expect(result.hintParams).toEqual({ repo: 'lobehub/lobe-chat' });
  });

  it('unknown: UNKNOWN mergeability shows a spinner row and disables the action', () => {
    const result = resolveMergeDock(makeInput({ detail: makeDetail({ mergeable: 'UNKNOWN' }) }));
    const base = result.rows.find((row) => row.key === 'base')!;
    expect(base.icon).toBe('spinner');
    expect(rowKeys(result)).not.toContain('rules');
    expect(result.action).toEqual({ kind: 'disabled', labelKey: PR_KEYS.action.calculating });
    expect(result.hintKey).toBe(PR_KEYS.hint.calculating);
  });

  it('actionError: adds an error row and clears the hint without changing the action', () => {
    const result = resolveMergeDock(
      makeInput({ ui: { bypass: false, error: 'gh: failed', method: 'squash' } }),
    );
    expect(rowKeys(result)).toContain('error');
    expect(result.hintKey).toBeUndefined();
    expect(result.action).toEqual({
      admin: false,
      kind: 'merge',
      method: 'squash',
      tone: 'success',
    });
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
