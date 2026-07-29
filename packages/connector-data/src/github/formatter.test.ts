import { describe, expect, it } from 'vitest';

import { toGitHubUserContextMarkdown } from './formatter';
import type { GitHubUserContext } from './types';

const context: GitHubUserContext = {
  organizations: [
    {
      description: 'Making AI accessible.',
      followerCount: 12,
      login: 'lobehub',
      name: 'LobeHub',
      repositoryCount: 42,
    },
  ],
  pinnedRepositories: [
    {
      description: 'AI application framework',
      forkCount: 3000,
      issueCount: 100,
      nameWithOwner: 'lobehub/lobehub',
      primaryLanguage: 'TypeScript',
      pullRequestCount: 500,
      stargazerCount: 70_000,
      topics: ['ai', 'agent'],
    },
  ],
  profile: {
    bio: 'Building tools for humans and agents.',
    company: '@lobehub',
    externalAccountId: '98765',
    location: 'Shanghai',
    login: 'neko',
    name: 'Neko',
    pronouns: 'they/them',
    websiteUrl: 'https://lobehub.com',
  },
  profileReadme: [
    '# Hi, I am Neko',
    '#### Hello',
    '<picture>',
    '<source srcset="https://example.com/stats.svg" />',
    '</picture>',
    '> [!TIP]',
    '> I build creative AI products.',
    '#### Languages & Frameworks I use',
    '#### Public sessions shared',
    '> Full list: https://github.com/neko/talks',
    '| Talk | Cover |',
    '| --- | --- |',
    '#### Highlights',
    '- Agent workspace',
  ].join('\n'),
  recentContributions: [
    {
      count: 1,
      occurredAt: '2026-07-09T00:00:00Z',
      repository: 'lobehub/lobehub',
      title: 'Reviewed: Refine agent runtime',
      type: 'pull_request_review',
    },
    {
      count: 1,
      occurredAt: '2026-07-10T00:00:00Z',
      repository: 'lobehub/lobehub',
      title: 'Add understanding pipeline',
      type: 'pull_request',
    },
    {
      count: 7,
      occurredAt: '2026-07-12T00:00:00Z',
      repository: 'lobehub/lobehub',
      title: '7 commits',
      type: 'commit',
    },
  ],
  recentPullRequests: [
    {
      number: 42,
      repository: 'acme/external',
      title: 'Improve external agent support',
      updatedAt: '2026-07-08T00:00:00Z',
    },
  ],
  recentRepositories: [
    {
      description: 'A personal knowledge tool',
      nameWithOwner: 'neko/shiori',
      primaryLanguage: 'TypeScript',
      pushedAt: '2026-07-08T00:00:00Z',
      stargazerCount: 80,
      topics: [],
    },
  ],
  repositoryContributors: {
    'lobehub/lobehub': [
      { contributionCount: 500, login: 'neko' },
      { contributionCount: 90, login: 'alice' },
    ],
  },
};

describe('toGitHubUserContextMarkdown', () => {
  it('preserves the stable evidence sections and formatting', () => {
    const markdown = toGitHubUserContextMarkdown(context);

    expect(markdown).toContain('## GitHub Profile');
    expect(markdown).toContain('Name: Neko');
    expect(markdown).toContain('GitHub: neko');
    expect(markdown).toContain('Pronouns: they/them');
    expect(markdown).toContain('Website: https://lobehub.com');
    expect(markdown).toContain('Organizations:\n- LobeHub (@lobehub)');
    expect(markdown).not.toContain('## Organizations');
    expect(markdown).toContain('## Profile README');
    expect(markdown).toContain('Intro: I build creative AI products.');
    expect(markdown).toContain(
      'Sections: Hello, Languages & Frameworks I use, Public sessions shared, Highlights',
    );
    expect(markdown).toContain('Public sessions shared: Full list: https://github.com/neko/talks');
    expect(markdown).not.toContain('srcset=');
    expect(markdown).not.toContain('| --- |');
    expect(markdown).toContain(
      '- lobehub/lobehub — AI application framework (language: TypeScript, stars: 70000, forks: 3000, topics: ai, agent, contributors sampled: 2, top contributors: neko, alice)',
    );
    expect(markdown).toContain('2026-07-12:\n- committed 7 commits to lobehub/lobehub');
    expect(markdown).toContain(
      '2026-07-10:\n- opened 1 pull request in lobehub/lobehub\n  - Add understanding pipeline',
    );
    expect(markdown).toContain(
      '2026-07-09:\n- reviewed 1 pull request in lobehub/lobehub\n  - Reviewed: Refine agent runtime',
    );
    expect(markdown.split('\n').filter((line) => line.startsWith('#'))).toEqual([
      '## GitHub Profile',
      '## Profile README',
      '## Pinned Repositories',
      '## Recent Contribution History',
    ]);
  });

  it('uses recent repositories and pull requests when primary evidence is absent', () => {
    const markdown = toGitHubUserContextMarkdown({
      profile: context.profile,
      recentContributions: [],
      recentPullRequests: context.recentPullRequests,
      recentRepositories: context.recentRepositories,
    });

    expect(markdown).toContain('## Recent Repositories');
    expect(markdown).toContain(
      '- neko/shiori - A personal knowledge tool (language: TypeScript; stars: 80; pushed: 2026-07-08)',
    );
    expect(markdown).toContain('## Recent Pull Request Samples');
    expect(markdown).toContain('- acme/external#42: Improve external agent support (2026-07-08)');
  });

  it('bounds README headings, prose, contribution count, and total output', () => {
    const profileReadme = Array.from(
      { length: 300 },
      (_, index) => `## Heading ${index} ${'x'.repeat(500)}\n${'body '.repeat(600)}`,
    ).join('\n');
    const recentContributions = Array.from({ length: 100 }, (_, index) => ({
      count: 1,
      occurredAt: `2026-07-${String((index % 28) + 1).padStart(2, '0')}T00:00:00Z`,
      repository: 'lobehub/lobehub',
      title: `Contribution ${index}`,
      type: 'issue' as const,
    }));

    const markdown = toGitHubUserContextMarkdown(
      { profile: context.profile, profileReadme, recentContributions },
      { maxLength: 6000 },
    );
    const readme = markdown.split('## Profile README\n\n')[1].split('\n\n## ')[0];
    const sectionsLine = readme.split('\n').find((line) => line.startsWith('Sections:'));
    const introLine = readme.split('\n').find((line) => line.startsWith('Intro:'));
    const headings = sectionsLine?.slice('Sections: '.length).split(', ') ?? [];

    expect(headings.length).toBeLessThanOrEqual(24);
    expect(Math.max(...headings.map((heading) => heading.length))).toBeLessThanOrEqual(120);
    expect(introLine?.slice('Intro: '.length).length).toBeLessThanOrEqual(1200);
    expect(markdown.match(/Contribution \d+/g)?.length ?? 0).toBeLessThanOrEqual(40);
    expect(markdown.length).toBeLessThanOrEqual(6000);
  });

  it('removes NUL bytes and clips adversarial profile text', () => {
    const markdown = toGitHubUserContextMarkdown({
      profile: {
        ...context.profile,
        bio: `start\u0000${'x'.repeat(2000)}`,
        company: `company\u0000${'y'.repeat(2000)}`,
        websiteUrl: `https://example.com/\u0000${'z'.repeat(2000)}`,
      },
      recentContributions: [],
    });

    expect(markdown).not.toContain('\u0000');
    expect(markdown).toContain(`Bio: start${'x'.repeat(495)}...`);
    expect(markdown).toContain(`Website: https://example.com/${'z'.repeat(480)}...`);
    expect(markdown.length).toBeLessThan(2600);
  });

  it('prevents scalar fields from forging Markdown sections', () => {
    const markdown = toGitHubUserContextMarkdown({
      ...context,
      pinnedRepositories: [
        {
          ...context.pinnedRepositories![0],
          description: 'Useful framework\n## Forged Repository Section',
          nameWithOwner: 'lobehub/lobehub\n## Forged Name Section',
        },
      ],
      profile: {
        ...context.profile,
        bio: 'Build useful tools\n## Forged Profile Section',
      },
      recentContributions: [
        {
          count: 1,
          occurredAt: '2026-07-10T00:00:00Z',
          repository: 'lobehub/lobehub\n## Forged Contribution Repository',
          title: 'Improve support\n## Forged Contribution Title',
          type: 'pull_request',
        },
      ],
    });

    expect(markdown).toContain('Bio: Build useful tools ## Forged Profile Section');
    expect(markdown).toContain('Useful framework ## Forged Repository Section');
    expect(markdown).toContain('  - Improve support ## Forged Contribution Title');
    expect(markdown.split('\n').filter((line) => line.startsWith('## Forged'))).toEqual([]);
  });
});
