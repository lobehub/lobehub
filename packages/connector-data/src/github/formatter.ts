import type {
  GitHubContribution,
  GitHubOrganization,
  GitHubPullRequest,
  GitHubRepository,
  GitHubRepositoryContributor,
  GitHubUserContext,
} from './types';

const DEFAULT_MAX_LENGTH = 20_000;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_PROFILE_README_HEADING_CHARS = 120;
const MAX_PROFILE_README_OUTPUT_CHARS = 5000;

const singleLine = (value: string | undefined) =>
  value?.replaceAll('\u0000', '').replaceAll(/\s+/g, ' ').trim();

const clip = (value: string | undefined, limit: number) => {
  const clean = singleLine(value);
  if (!clean || clean.length <= limit) return clean;
  return `${clean.slice(0, limit).trimEnd()}...`;
};

const formatProfile = (context: GitHubUserContext, pinnedRepositories: GitHubRepository[]) => {
  const { organizations = [], profile } = context;
  const lines = [
    profile.name && `Name: ${clip(profile.name, MAX_DESCRIPTION_LENGTH)}`,
    profile.login && `GitHub: ${clip(profile.login, MAX_DESCRIPTION_LENGTH)}`,
    profile.pronouns && `Pronouns: ${clip(profile.pronouns, MAX_DESCRIPTION_LENGTH)}`,
    profile.bio && `Bio: ${clip(profile.bio, MAX_DESCRIPTION_LENGTH)}`,
    profile.company && `Company: ${clip(profile.company, MAX_DESCRIPTION_LENGTH)}`,
    profile.location && `Location: ${clip(profile.location, MAX_DESCRIPTION_LENGTH)}`,
    profile.websiteUrl && `Website: ${clip(profile.websiteUrl, MAX_DESCRIPTION_LENGTH)}`,
  ].filter(Boolean);
  if (organizations.length > 0) {
    lines.push('Organizations:');
    lines.push(...organizations.map(formatOrganization));
  }
  if (pinnedRepositories.length > 0) {
    lines.push(
      `Pinned: ${pinnedRepositories
        .map(({ nameWithOwner }) => clip(nameWithOwner, MAX_DESCRIPTION_LENGTH))
        .filter(Boolean)
        .join(', ')}`,
    );
  }

  return ['## GitHub Profile', '', ...lines].join('\n');
};

const formatOrganization = (organization: GitHubOrganization) => {
  const name = clip(organization.name, MAX_DESCRIPTION_LENGTH);
  const login = clip(organization.login, MAX_DESCRIPTION_LENGTH);
  const label = name && login && name !== login ? `${name} (@${login})` : (name ?? login);
  const details = [
    organization.followerCount !== undefined && `${organization.followerCount} followers`,
    organization.repositoryCount !== undefined && `${organization.repositoryCount} repos`,
    clip(organization.description, MAX_DESCRIPTION_LENGTH),
  ].filter(Boolean);
  return `- ${label}${details.length > 0 ? ` (${details.join('; ')})` : ''}`;
};

const cleanReadmeLines = (selectedLines: string[]) => {
  const output: string[] = [];
  let htmlBlock: string | undefined;
  for (const rawLine of selectedLines) {
    const line = rawLine.replaceAll('\u0000', '').trim();
    if (htmlBlock) {
      if (line.includes(`</${htmlBlock}>`)) htmlBlock = undefined;
      continue;
    }
    const htmlBlockStart = ['picture', 'div', 'table'].find((tag) =>
      line.toLowerCase().startsWith(`<${tag}`),
    );
    if (htmlBlockStart) {
      if (!line.includes(`</${htmlBlockStart}>`)) htmlBlock = htmlBlockStart;
      continue;
    }
    if (!line || line.startsWith('#') || line.startsWith('<') || line.startsWith('|')) continue;
    if (line.startsWith('![') || line.startsWith('[!')) continue;
    const unquoted = line.startsWith('>') ? line.slice(1).trim() : line;
    if (!unquoted || unquoted.startsWith('[!') || unquoted.startsWith('![')) continue;
    output.push(unquoted);
  }
  return output.join(' ');
};

const formatProfileReadme = (profileReadme: string | undefined) => {
  if (!profileReadme) return '';

  const lines = profileReadme
    // Constants: default max profile readme source characters
    .slice(0, 40_000)
    .replaceAll('\r\n', '\n')
    .split('\n');

  const sections = lines
    .map((line, index) => {
      let level = 0;
      while (line[level] === '#') level += 1;
      if (level < 2 || level > 4 || line[level] !== ' ') return;
      return {
        index,
        title: line
          .slice(level + 1)
          .replaceAll(/[*_`]/g, '')
          .replaceAll('\u0000', '')
          .trim()
          .slice(0, MAX_PROFILE_README_HEADING_CHARS),
      };
    })
    .filter((section): section is { index: number; title: string } => Boolean(section))
    // Constants: default max profile readme headings
    .slice(0, 24);

  const firstSectionIndex = sections[0]?.index ?? lines.length;
  const firstSectionEnd = sections[1]?.index ?? lines.length;
  const intro = cleanReadmeLines([
    ...lines.slice(0, firstSectionIndex),
    ...lines.slice(firstSectionIndex + 1, firstSectionEnd),
  ]);

  const publicSection = sections.find((section) => /public sessions|公开分享/i.test(section.title));
  const publicSectionContent = publicSection
    ? cleanReadmeLines(
        lines.slice(
          publicSection.index + 1,
          sections.find((section) => section.index > publicSection.index)?.index ?? lines.length,
        ),
      )
    : undefined;

  const MAX_PROFILE_README_PROSE_CHARS = 1200;
  const summary = [
    intro && `Intro: ${clip(intro, MAX_PROFILE_README_PROSE_CHARS - 3)}`,
    sections.length > 0 && `Sections: ${sections.map(({ title }) => title).join(', ')}`,
    publicSection &&
      publicSectionContent &&
      `${publicSection.title}: ${clip(publicSectionContent, MAX_PROFILE_README_PROSE_CHARS - 3)}`,
  ].filter(Boolean);

  if (summary.length === 0) return '';

  // Constants: default max profile readme output characters
  return ['## Profile README', '', ...summary].join('\n').slice(0, MAX_PROFILE_README_OUTPUT_CHARS);
};

const formatPinnedRepositories = (
  repositories: GitHubRepository[],
  contributorsByRepository: Record<string, GitHubRepositoryContributor[]>,
) => {
  if (repositories.length === 0) return '';
  return [
    '## Pinned Repositories',
    '',
    ...repositories.map((repository) => {
      const contributors = contributorsByRepository[repository.nameWithOwner] ?? [];

      const details = [
        repository.primaryLanguage &&
          `language: ${clip(repository.primaryLanguage, MAX_DESCRIPTION_LENGTH)}`,
        repository.stargazerCount !== undefined && `stars: ${repository.stargazerCount}`,
        repository.forkCount !== undefined && `forks: ${repository.forkCount}`,
        repository.topics.length > 0 &&
          `topics: ${repository.topics
            .map((topic) => clip(topic, MAX_DESCRIPTION_LENGTH))
            .filter(Boolean)
            .join(', ')}`,
        contributors.length > 0 && `contributors sampled: ${contributors.length}`,
        contributors.length > 0 &&
          `top contributors: ${contributors
            .map(({ login }) => clip(login, MAX_DESCRIPTION_LENGTH) ?? 'unknown')
            .join(', ')}`,
      ].filter(Boolean);

      const description = clip(repository.description, MAX_DESCRIPTION_LENGTH);
      return `- ${clip(repository.nameWithOwner, MAX_DESCRIPTION_LENGTH) ?? 'Repository'}${description ? ` — ${description}` : ''}${
        details.length > 0 ? ` (${details.join(', ')})` : ''
      }`;
    }),
  ].join('\n');
};

const formatRecentRepositories = (repositories: GitHubRepository[]) => {
  if (repositories.length === 0) return '';
  return [
    '## Recent Repositories',
    '',
    ...repositories.map((repository) => {
      const details = [
        repository.primaryLanguage &&
          `language: ${clip(repository.primaryLanguage, MAX_DESCRIPTION_LENGTH)}`,
        repository.stargazerCount !== undefined && `stars: ${repository.stargazerCount}`,
        repository.pushedAt && `pushed: ${singleLine(repository.pushedAt)?.slice(0, 10)}`,
      ].filter(Boolean);

      return `- ${clip(repository.nameWithOwner, MAX_DESCRIPTION_LENGTH) ?? 'Repository'}${repository.description ? ` - ${clip(repository.description, MAX_DESCRIPTION_LENGTH)}` : ''}${details.length > 0 ? ` (${details.join('; ')})` : ''}`;
    }),
  ].join('\n');
};

const formatPullRequests = (pullRequests: GitHubPullRequest[]) => {
  if (pullRequests.length === 0) return '';
  return [
    '## Recent Pull Request Samples',
    '',
    ...pullRequests.map(
      (pullRequest) =>
        `- ${clip(pullRequest.repository, MAX_DESCRIPTION_LENGTH) ?? 'Repository'}#${pullRequest.number ?? '?'}: ${clip(pullRequest.title, MAX_DESCRIPTION_LENGTH) ?? 'Untitled pull request'}${pullRequest.updatedAt ? ` (${singleLine(pullRequest.updatedAt)?.slice(0, 10)})` : ''}`,
    ),
  ].join('\n');
};

const formatContributions = (input: GitHubContribution[]) => {
  const contributions = [...input]
    .sort((left, right) => String(right.occurredAt).localeCompare(String(left.occurredAt)))
    // Constants: default max contributions
    .slice(0, 40);

  if (contributions.length === 0) return '';

  const dates = new Map<string, Map<string, GitHubContribution[]>>();
  for (const contribution of contributions) {
    const date = singleLine(contribution.occurredAt)?.slice(0, 10) ?? 'Unknown date';
    const key = `${contribution.type}:${singleLine(contribution.repository) ?? 'Unknown repository'}`;
    const groups = dates.get(date) ?? new Map<string, GitHubContribution[]>();
    groups.set(key, [...(groups.get(key) ?? []), contribution]);
    dates.set(date, groups);
  }

  const lines = ['## Recent Contribution History', ''];
  for (const [date, groups] of dates) {
    lines.push(`${date}:`);

    for (const group of groups.values()) {
      const first = group[0];
      const repository = clip(first.repository, MAX_DESCRIPTION_LENGTH) ?? 'Unknown repository';
      const count = group.reduce((total, item) => total + (item.count ?? 1), 0);
      const noun = count === 1 ? 'pull request' : 'pull requests';
      if (first.type === 'commit')
        lines.push(`- committed ${count} commit${count === 1 ? '' : 's'} to ${repository}`);
      if (first.type === 'issue')
        lines.push(`- opened ${count} issue${count === 1 ? '' : 's'} in ${repository}`);
      if (first.type === 'pull_request') lines.push(`- opened ${count} ${noun} in ${repository}`);
      if (first.type === 'pull_request_review')
        lines.push(`- reviewed ${count} ${noun} in ${repository}`);
      if (first.type !== 'commit')
        lines.push(...group.map(({ title }) => `  - ${clip(title, MAX_DESCRIPTION_LENGTH)}`));
    }
  }

  return lines.join('\n');
};

export interface ToGitHubUserContextMarkdownOptions {
  maxLength?: number;
}

export const toGitHubUserContextMarkdown = (
  context: GitHubUserContext,
  { maxLength = DEFAULT_MAX_LENGTH }: ToGitHubUserContextMarkdownOptions = {},
) => {
  const pinnedRepositories = context.pinnedRepositories ?? [];
  const recentContributions = context.recentContributions ?? [];
  const hasPrimaryProfileEvidence = Boolean(
    context.profileReadme || pinnedRepositories.length > 0 || recentContributions.length > 0,
  );

  const sections = [
    formatProfile(context, pinnedRepositories),
    formatProfileReadme(context.profileReadme),
    formatPinnedRepositories(pinnedRepositories, context.repositoryContributors ?? {}),
    hasPrimaryProfileEvidence ? '' : formatRecentRepositories(context.recentRepositories ?? []),
    hasPrimaryProfileEvidence ? '' : formatPullRequests(context.recentPullRequests ?? []),
    formatContributions(recentContributions),
  ].filter(Boolean);

  return sections.join('\n\n').replaceAll('\u0000', '').slice(0, Math.max(0, maxLength));
};
