import type { LoaderFunctionArgs } from 'react-router';

// The route tables sit in the entry chunk's static graph; resolving the real
// loaders on first use keeps the expertise store in the My rules and
// Self-evolving routes' lazy chunks.

export const memoryRulesLoader = () =>
  import('@/routes/(main)/memory/rules/rulesLoader').then((module) => module.memoryRulesLoader());

export const selfLearningLoader = (args: LoaderFunctionArgs) =>
  import('@/routes/(main)/agent/self-learning/selfLearningLoader').then((module) =>
    module.selfLearningLoader(args),
  );
