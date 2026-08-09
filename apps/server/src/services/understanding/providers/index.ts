import type { UnderstandingProvider } from '../types';
import { githubUnderstandingProvider } from './github';
import { gmailUnderstandingProvider } from './gmail';
import { notionUnderstandingProvider } from './notion';

export const understandingProviders = [
  githubUnderstandingProvider,
  gmailUnderstandingProvider,
  notionUnderstandingProvider,
] as const satisfies readonly UnderstandingProvider[];

export const understandingProviderMap = new Map<string, UnderstandingProvider>(
  understandingProviders.map((provider) => [provider.id, provider]),
);

export { githubUnderstandingProvider, gmailUnderstandingProvider, notionUnderstandingProvider };
