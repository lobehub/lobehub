import { describe, expect, it } from 'vitest';

import { CONTRIBUTED_REPOSITORY_METADATA_QUERY, CONTRIBUTIONS_QUERY } from './contributions';

describe('CONTRIBUTIONS_QUERY', () => {
  it('collects a time-bounded repository catalog and per-kind activity totals', () => {
    expect(CONTRIBUTIONS_QUERY).toContain('query ConnectorDataGitHubContributions(');
    expect(CONTRIBUTIONS_QUERY).toContain('topRepositories(');
    expect(CONTRIBUTIONS_QUERY).toContain('field: STARGAZERS');
    expect(CONTRIBUTIONS_QUERY).toContain('contributionsCollection(from: $from)');
    expect(CONTRIBUTIONS_QUERY).toContain(
      'recentContributionsCollection: contributionsCollection(from: $recentFrom)',
    );
    expect(CONTRIBUTIONS_QUERY).toContain(
      'commitContributionsByRepository(maxRepositories: $repositoryFirst)',
    );
    expect(CONTRIBUTIONS_QUERY).toContain(
      'pullRequestContributionsByRepository(maxRepositories: $repositoryFirst)',
    );
    expect(CONTRIBUTIONS_QUERY).toContain(
      'pullRequestContributions(first: $contributionFirst, orderBy: { direction: DESC })',
    );
    expect(CONTRIBUTIONS_QUERY.match(/repository \{\s+id\s+nameWithOwner\s+\}/g)).toHaveLength(4);
  });

  it('enriches only repository ids selected after contribution ranking', () => {
    expect(CONTRIBUTED_REPOSITORY_METADATA_QUERY).toContain('nodes(ids: $ids)');
    expect(CONTRIBUTED_REPOSITORY_METADATA_QUERY).toContain('... on Repository');
    expect(CONTRIBUTED_REPOSITORY_METADATA_QUERY).toContain('stargazerCount');
  });
});
