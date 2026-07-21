import { describe, expect, it } from 'vitest';

import { CONTRIBUTIONS_QUERY } from './contributions';

describe('CONTRIBUTIONS_QUERY', () => {
  it('bounds recent contributions without reducing signal limits', () => {
    expect(CONTRIBUTIONS_QUERY).toContain(
      'query ConnectorDataGitHubContributions($contributionFirst: Int!, $from: DateTime!)',
    );
    expect(CONTRIBUTIONS_QUERY).toContain('contributionsCollection(from: $from)');
    expect(CONTRIBUTIONS_QUERY).toContain('commitContributionsByRepository(maxRepositories: 10)');
    expect(CONTRIBUTIONS_QUERY).toContain(
      'contributions(first: 3, orderBy: { field: OCCURRED_AT, direction: DESC })',
    );
    expect(CONTRIBUTIONS_QUERY).toContain(
      'pullRequestContributions(first: $contributionFirst, orderBy: { direction: DESC })',
    );
  });
});
