import type { UnderstandingProvider } from '../types';
import { githubUnderstandingProvider } from './github';
import { gmailUnderstandingProvider } from './gmail';
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

export {
  githubUnderstandingProvider,
  gmailUnderstandingProvider,
  notionUnderstandingProvider,
  twitterUnderstandingProvider,
};
