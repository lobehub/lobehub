import type { GitHubSkillCandidate } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { getGithubSkillChoices, toggleGithubSkillPaths } from './githubSkillSelection';

const skill = (
  path: string,
  status: GitHubSkillCandidate['status'] = 'new',
): GitHubSkillCandidate => ({
  description: '',
  name: path.split('/').at(-1)!,
  path,
  revision: null,
  status,
});

const collection = [
  skill('writing/draft'),
  skill('writing/edit', 'update'),
  skill('design/layout'),
  skill('writing/style'),
  skill('design/Style'),
  skill('writing/installed', 'unchanged'),
];

describe('GitHub collection selection', () => {
  it('selects or clears just the eligible matches and preserves manual and hidden choices', () => {
    const selected = ['design/layout', 'writing/style', 'writing/edit'];
    const { bulkPaths, checkedCount } = getGithubSkillChoices(
      collection,
      selected,
      ' WRITING ',
      false,
    );
    expect(bulkPaths).toEqual(['writing/draft', 'writing/edit']);
    expect(checkedCount).toBe(1);

    const all = toggleGithubSkillPaths(selected, bulkPaths, true);
    expect(getGithubSkillChoices(collection, all, 'writing', false).checkedCount).toBe(2);
    expect(toggleGithubSkillPaths(all, bulkPaths, false)).toEqual([
      'design/layout',
      'writing/style',
    ]);
  });

  it('reviews all selected paths across searches, including same-name skills chosen manually', () => {
    const selected = ['writing/style', 'design/layout'];
    const review = getGithubSkillChoices(collection, selected, 'no matches', true);
    expect(review.visible.map((item) => item.path)).toEqual(['design/layout', 'writing/style']);
    expect(review.duplicateNames.has('style')).toBe(true);
    expect(review.selectedNames.has('style')).toBe(true);
    const remaining = toggleGithubSkillPaths(selected, ['writing/style'], false);
    expect(
      getGithubSkillChoices(collection, remaining, 'no matches', true).selectedNames.has('style'),
    ).toBe(false);
    expect(getGithubSkillChoices(collection, remaining, 'no matches', false).visible).toEqual([]);
  });

  it('keeps root paths selectable and excludes unavailable skills', () => {
    const root = { ...skill('repo'), path: '', description: 'Root candidate' };
    const choices = getGithubSkillChoices(
      [
        root,
        skill('invalid', 'invalid'),
        skill('conflict', 'conflict'),
        skill('blocked', 'forbidden'),
      ],
      [],
      '',
      false,
    );
    expect(choices.bulkPaths).toEqual(['']);
    expect(getGithubSkillChoices([root], [''], 'CANDIDATE', false).checkedCount).toBe(1);
  });
});
