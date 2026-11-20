import type { LoaderFunctionArgs } from 'react-router';

/**
 * Route-table entry for the agent chat pre-paint hydrate.
 *
 * The real loader imports the chat and agent stores. The route tables sit in the
 * entry chunk's static graph, so importing it directly would pull both stores
 * into the first screen; resolving it on first use keeps them in the agent
 * route's lazy chunks, which load in parallel with this one.
 */
export const agentChatTopicListLoader = (args: LoaderFunctionArgs) =>
  import('@/routes/(main)/agent/(chat)/topicListLoader').then((module) =>
    module.agentChatTopicListLoader(args),
  );
