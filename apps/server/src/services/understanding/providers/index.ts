import type { UnderstandingProvider } from '../types';
import { collectConfluenceUnderstanding, confluenceUnderstandingProvider } from './confluence';
import { githubUnderstandingProvider } from './github';
import { gmailUnderstandingProvider } from './gmail';
import { collectJiraUnderstanding, jiraUnderstandingProvider } from './jira';
import { collectLinearUnderstanding, linearUnderstandingProvider } from './linear';
import { notionUnderstandingProvider } from './notion';
import { twitterUnderstandingProvider } from './twitter';

export const understandingProviders = [
  githubUnderstandingProvider,
  gmailUnderstandingProvider,
  notionUnderstandingProvider,
  twitterUnderstandingProvider,
] as const satisfies readonly UnderstandingProvider[];

export const understandingProviderMap = new Map<string, UnderstandingProvider>(
  understandingProviders.map((provider) => [provider.id, provider]),
);

/**
 * Collectors outside the personal Understanding list above: available to other
 * analyses (such as a team's) without being offered in personal onboarding.
 */
export const additionalUnderstandingProviders = [
  confluenceUnderstandingProvider,
  jiraUnderstandingProvider,
  linearUnderstandingProvider,
] as const satisfies readonly UnderstandingProvider[];

export {
  collectConfluenceUnderstanding,
  collectJiraUnderstanding,
  collectLinearUnderstanding,
  confluenceUnderstandingProvider,
  githubUnderstandingProvider,
  gmailUnderstandingProvider,
  jiraUnderstandingProvider,
  linearUnderstandingProvider,
  notionUnderstandingProvider,
  twitterUnderstandingProvider,
};
