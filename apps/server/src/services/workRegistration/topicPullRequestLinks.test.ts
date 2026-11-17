import { describe, expect, it, vi } from 'vitest';

import {
  linkTopicPullRequest,
  parsePullRequestUrl,
  setTopicPullRequestDismissed,
} from './topicPullRequestLinks';

/** An in-memory topic row whose metadata writes honour `onlyIf`. */
const createTopicModel = (pullRequests?: Record<string, unknown>, interleave?: () => void) => {
  const row = { metadata: pullRequests ? { pullRequests } : ({} as Record<string, any>) };
  return {
    findById: vi.fn(async () => structuredClone(row)),
    row,
    updateMetadata: vi.fn(async (_id: string, patch: any, options: any) => {
      interleave?.();
      if (options?.onlyIf && !options.onlyIf(row.metadata)) return [];
      row.metadata = { ...row.metadata, ...patch };
      return [row];
    }),
  };
};

const link = (n: number, source: 'branch' | 'manual' = 'manual') => ({
  identifier: `a/b#${n}`,
  source,
  url: `https://github.com/a/b/pull/${n}`,
  vouched: source === 'manual',
});

describe('parsePullRequestUrl', () => {
  it('reads a github.com pull request URL into its identity', () => {
    expect(parsePullRequestUrl(' https://github.com/LobeHub/lobehub/pull/12/files?x=1 ')).toEqual({
      identifier: 'LobeHub/lobehub#12',
      number: 12,
      repoFullName: 'LobeHub/lobehub',
      url: 'https://github.com/LobeHub/lobehub/pull/12',
    });
    expect(parsePullRequestUrl('https://github.com/a/b/issues/1')).toBeNull();
    expect(parsePullRequestUrl('http://evil.com/a/b/pull/1')).toBeNull();
  });
});

describe('linkTopicPullRequest', () => {
  it('adds a link and brings a removed PR back', async () => {
    const topicModel = createTopicModel({ dismissed: ['a/b#1'] });

    expect(await linkTopicPullRequest(topicModel as any, 't1', link(1))).toBe(true);

    expect(topicModel.row.metadata.pullRequests.dismissed).toBeUndefined();
    expect(topicModel.row.metadata.pullRequests.links).toEqual([
      expect.objectContaining({ identifier: 'a/b#1', source: 'manual', vouched: true }),
    ]);
  });

  it('never lets a branch match downgrade a manual link or undo a removal', async () => {
    const manual = createTopicModel({ links: [{ ...link(1), linkedAt: '2026-11-01T00:00:00Z' }] });
    await linkTopicPullRequest(manual as any, 't1', link(1, 'branch'));
    expect(manual.row.metadata.pullRequests.links[0].source).toBe('manual');
    expect(manual.updateMetadata).not.toHaveBeenCalled();

    const removed = createTopicModel({ dismissed: ['A/B#2'] });
    await linkTopicPullRequest(removed as any, 't1', link(2, 'branch'));
    expect(removed.updateMetadata).not.toHaveBeenCalled();
  });

  it('retries against a write that landed in between', async () => {
    let raced = false;
    const topicModel = createTopicModel(undefined, () => {
      if (raced) return;
      raced = true;
      topicModel.row.metadata = {
        pullRequests: { links: [{ ...link(9), linkedAt: '2026-11-01T00:00:00Z' }] },
      };
    });

    expect(await linkTopicPullRequest(topicModel as any, 't1', link(1))).toBe(true);
    expect(topicModel.row.metadata.pullRequests.links.map((l: any) => l.identifier)).toEqual([
      'a/b#9',
      'a/b#1',
    ]);
  });

  it('writes nothing for a topic the caller cannot read', async () => {
    const topicModel = { findById: vi.fn(async () => undefined), updateMetadata: vi.fn() };
    expect(await linkTopicPullRequest(topicModel as any, 't1', link(1))).toBe(false);
    expect(topicModel.updateMetadata).not.toHaveBeenCalled();
  });
});

describe('setTopicPullRequestDismissed', () => {
  it('hides and shows a PR without touching its links', async () => {
    const topicModel = createTopicModel({ links: [{ ...link(1), linkedAt: 'x' }] });

    await setTopicPullRequestDismissed(topicModel as any, 't1', 'a/b#1', true);
    expect(topicModel.row.metadata.pullRequests).toMatchObject({ dismissed: ['a/b#1'] });

    await setTopicPullRequestDismissed(topicModel as any, 't1', 'A/B#1', false);
    expect(topicModel.row.metadata.pullRequests.dismissed).toBeUndefined();
    expect(topicModel.row.metadata.pullRequests.links).toHaveLength(1);
  });
});
