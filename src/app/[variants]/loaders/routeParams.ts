import { type LoaderFunctionArgs } from 'react-router-dom';

/**
 * Generic route params loader
 * Extracts all params from the route and returns them
 * Usage: loader: routeParamsLoader
 * Access in component: const params = useLoaderData<RouteParams>();
 */
export interface RouteParams {
  [key: string]: string | undefined;
}

export const routeParamsLoader = ({ params }: LoaderFunctionArgs): RouteParams => {
  return params;
};

/**
 * Specific loader for routes with 'slug' param
 * Returns: { slug: string }
 */
export interface SlugParams {
  slug: string;
}

export const slugLoader = ({ params }: LoaderFunctionArgs): SlugParams => {
  if (!params.slug) {
    throw new Error('Slug parameter is required');
  }
  return { slug: params.slug };
};

export const agentIdLoader = ({ params }: LoaderFunctionArgs): { agentId: string } => {
  if (!params.aid) {
    throw new Error('Slug parameter is required');
  }
  return { agentId: params.aid };
};

export const groupIdLoader = ({ params }: LoaderFunctionArgs): { groupId: string } => {
  if (!params.gid) {
    throw new Error('Group ID parameter is required');
  }
  return { groupId: params.gid };
};

/**
 * Specific loader for routes with 'id' param
 * Returns: { id: string }
 */
export interface IdParams {
  id: string;
}

export const idLoader = ({ params }: LoaderFunctionArgs): IdParams => {
  if (!params.id) {
    throw new Error('ID parameter is required');
  }
  return { id: params.id };
};

/**
 * Specific loader for settings tab routes
 * Returns: { tab: string }
 */
export interface SettingsTabParams {
  tab: string;
}

export const settingsTabLoader = ({ params }: LoaderFunctionArgs): SettingsTabParams => {
  if (!params.tab) {
    throw new Error('Tab parameter is required');
  }
  return { tab: params.tab };
};

/**
 * Specific loader for provider detail routes
 * Returns: { providerId: string }
 */
export interface ProviderIdParams {
  providerId: string;
}

export const providerIdLoader = ({ params }: LoaderFunctionArgs): ProviderIdParams => {
  if (!params.providerId) {
    throw new Error('Provider ID parameter is required');
  }
  return { providerId: params.providerId };
};

/**
 * Specific loader for memory type routes
 * Returns: { type: MemoryType }
 */
export type MemoryType = 'identities' | 'contexts' | 'preferences' | 'experiences';

export interface MemoryTypeParams {
  type: MemoryType;
}

export const memoryTypeLoader = ({ params }: LoaderFunctionArgs): MemoryTypeParams => {
  if (!params.type) {
    throw new Error('Memory type parameter is required');
  }
  return { type: params.type as MemoryType };
};
