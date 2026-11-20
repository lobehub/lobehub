import { describe, expect, it } from 'vitest';

import type { ScmChangeRequestItem } from '@/database/schemas';

import { parseChangeRequestUrl } from '../../scm/changeRequestUrl';
import {
  addPullRequestLink,
  listAcceptancePullRequests,
  removePullRequestLink,
} from '../acceptancePullRequests';

const parse = (url: string) => {
  const parsed = parseChangeRequestUrl(url);
  if (!parsed) throw new Error(`not a PR url: ${url}`);
  return parsed;
};

const pr = parse('https://github.com/lobehub/lobehub/pull/20171');
const now = new Date('2026-10-06T00:00:00Z');

describe('acceptance pull request links', () => {
  it('links a PR opened after the last round, once, whatever casing is pasted', () => {
    const first = addPullRequestLink(undefined, pr, 'Durable waits', now);
    const again = addPullRequestLink(
      first,
      parse('https://github.com/LobeHub/LobeHub/pull/20171/files'),
      undefined,
      new Date('2026-10-07T00:00:00Z'),
    );

    expect(again).toEqual([
      {
        linkedAt: now.toISOString(),
        number: 20171,
        provider: 'github',
        repoFullName: 'LobeHub/LobeHub',
        title: 'Durable waits',
        url: 'https://github.com/LobeHub/LobeHub/pull/20171',
      },
    ]);
  });

  it('keeps stacked PRs side by side and unlinks one without touching the other', () => {
    const stacked = parse('https://github.com/lobehub/lobehub/pull/20172');
    const links = addPullRequestLink(
      addPullRequestLink(undefined, pr, undefined, now),
      stacked,
      undefined,
      now,
    );

    expect(removePullRequestLink(links, pr)).toEqual([links[1]]);
    expect(
      removePullRequestLink(links, parse('https://github.com/lobehub/lobehub/pull/2017')),
    ).toBeNull();
  });

  it('lists verified provider rows first and drops hand links they already cover', () => {
    const row = {
      ciStatus: 'success',
      isDraft: false,
      mergedAt: null,
      number: 20171,
      provider: 'github',
      repoFullName: 'lobehub/lobehub',
      reviewDecision: 'approved',
      state: 'open',
      title: 'From provider',
      topicId: 'private-topic',
      url: pr.url,
    } as unknown as ScmChangeRequestItem;
    const links = addPullRequestLink(
      addPullRequestLink(
        undefined,
        parse('https://github.com/LOBEHUB/lobehub/pull/20171'),
        undefined,
        now,
      ),
      parse('https://github.com/lobehub/lobehub/pull/20172'),
      'Stacked CLI',
      now,
    );

    const listed = listAcceptancePullRequests([row], links);

    expect(listed).toEqual([
      expect.objectContaining({ number: 20171, source: 'provider', state: 'open' }),
      expect.objectContaining({
        number: 20172,
        source: 'manual',
        state: null,
        title: 'Stacked CLI',
      }),
    ]);
    expect(listed[0]).not.toHaveProperty('topicId');
  });
});
