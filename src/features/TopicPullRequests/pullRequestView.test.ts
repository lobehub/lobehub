import { describe, expect, it } from 'vitest';

import { pickPrimaryPullRequest, resolvePullRequestView, rollupChecks } from './pullRequestView';

const item = (number: number, overrides: Record<string, unknown> = {}) =>
  ({
    identifier: `lobehub/lobehub#${number}`,
    linkedAt: new Date(),
    number,
    repoFullName: 'lobehub/lobehub',
    scm: null,
    source: 'created',
    status: 'open',
    title: `PR ${number}`,
    url: `https://github.com/lobehub/lobehub/pull/${number}`,
    workId: `wk-${number}`,
    ...overrides,
  }) as any;

const detail = (overrides: Record<string, unknown> = {}) =>
  ({
    checks: [{ name: 'ci', required: true, status: 'pending' }],
    isDraft: false,
    repo: { name: 'lobehub', owner: 'lobehub' },
    state: 'merged',
    title: 'From device',
    url: 'https://github.com/lobehub/lobehub/pull/1',
    ...overrides,
  }) as any;

describe('resolvePullRequestView', () => {
  it('prefers the GitHub App state and marks it confirmed', () => {
    const autoFix = {
      changeRequestId: 'scr-1',
      enabled: false,
      maxWakes: 3,
      ownerTopic: null,
      ownerTopicId: 't1',
      wakeCount: 2,
    };
    const view = resolvePullRequestView(
      item(1, {
        scm: {
          autoFix,
          ciStatus: 'failure',
          isDraft: false,
          mergedAt: null,
          state: 'open',
          title: 'App',
        },
      }),
      { confirmed: false, detail: detail() },
    );
    expect(view).toMatchObject({
      autoFix,
      ciStatus: 'failure',
      confirmed: true,
      state: 'open',
      title: 'App',
    });
  });

  it('uses the device answer only for the same repository', () => {
    expect(resolvePullRequestView(item(1), { confirmed: true, detail: detail() })).toMatchObject({
      ciStatus: 'pending',
      confirmed: true,
      state: 'merged',
      title: 'From device',
    });
    const other = resolvePullRequestView(item(1), {
      confirmed: true,
      detail: detail({ repo: { name: 'other', owner: 'x' } }),
    });
    expect(other).toMatchObject({ confirmed: false, state: 'open', title: 'PR 1' });
    // Auto-fix rides on the GitHub App's webhooks; without its row there is none.
    expect(other.autoFix).toBeUndefined();
  });

  it('falls back to the status the agent commands recorded', () => {
    expect(resolvePullRequestView(item(2, { status: 'draft' }))).toMatchObject({
      confirmed: false,
      isDraft: true,
      state: 'open',
    });
    expect(resolvePullRequestView(item(3, { status: 'merged' })).state).toBe('merged');
  });
});

describe('pickPrimaryPullRequest', () => {
  it('names the latest open PR, else the latest one', () => {
    const merged = resolvePullRequestView(item(1, { status: 'merged' }));
    const open = resolvePullRequestView(item(2));
    expect(pickPrimaryPullRequest([merged, open])?.number).toBe(2);
    expect(pickPrimaryPullRequest([merged])?.number).toBe(1);
    expect(pickPrimaryPullRequest([])).toBeUndefined();
  });
});

describe('rollupChecks', () => {
  it('rolls checks up to failure, pending or success', () => {
    expect(rollupChecks([])).toBeUndefined();
    expect(rollupChecks([{ status: 'success' }, { status: 'failure' }] as any)).toBe('failure');
    expect(rollupChecks([{ status: 'success' }, { status: 'pending' }] as any)).toBe('pending');
    expect(rollupChecks([{ status: 'success' }, { status: 'skipped' }] as any)).toBe('success');
  });
});

describe('resolvePullRequestView · localDetail', () => {
  it('marks a PR openable in the sidebar only when the device read its repository', () => {
    const scm = { ciStatus: null, isDraft: false, mergedAt: null, state: 'open', title: 'App' };
    expect(
      resolvePullRequestView(item(1, { scm }), { confirmed: true, detail: detail() }).localDetail,
    ).toBe(true);
    expect(
      resolvePullRequestView(item(1, { scm }), {
        confirmed: true,
        detail: detail({ repo: { name: 'other', owner: 'x' } }),
      }).localDetail,
    ).toBe(false);
    expect(resolvePullRequestView(item(1, { scm })).localDetail).toBe(false);
  });
});

describe('resolvePullRequestView · trust', () => {
  it('carries how the PR was linked and whether it is vouched', () => {
    expect(resolvePullRequestView(item(4, { source: 'branch', vouched: false }))).toMatchObject({
      source: 'branch',
      vouched: false,
    });
    // A list persisted before these fields existed.
    expect(resolvePullRequestView(item(5, { source: undefined }))).toMatchObject({
      source: 'created',
      vouched: true,
    });
  });
});

describe('resolvePullRequestView · untitled', () => {
  it('names the repository when no title is known yet, not the number again', () => {
    expect(resolvePullRequestView(item(12, { title: null })).title).toBe('lobehub/lobehub');
  });
});
