import type { LoaderFunctionArgs } from 'react-router';

/**
 * Route-table entries for the resource-access pre-paint hydrate.
 *
 * The real loader imports the resource-permission store. The route tables sit in
 * the entry chunk's static graph, so importing it directly would pull the store
 * into the first screen; resolving it on first use keeps it in a lazy chunk.
 */
const loadAccess = () => import('@/features/ResourcePermission/accessLoader');

export const agentAccessLoader = ({ params }: LoaderFunctionArgs) =>
  loadAccess().then((module) => module.preHydrateResourceAccess('agent', params.aid));

export const agentGroupAccessLoader = ({ params }: LoaderFunctionArgs) =>
  loadAccess().then((module) => module.preHydrateResourceAccess('agentGroup', params.gid));
