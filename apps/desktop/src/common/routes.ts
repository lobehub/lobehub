/**
 * Route interception type, describing the mapping between intercepted routes and target windows
 */
export interface RouteInterceptConfig {
  /**
   * Whether to always open in a new window, even if target window already exists
   */
  alwaysOpenNew?: boolean;

  /**
   * Description
   */
  description: string;

  /**
   * Whether interception is enabled
   */
  enabled: boolean;

  /**
   * Route pattern prefix, e.g., '/settings'
   */
  pathPrefix: string;

  /**
   * Target window identifier
   */
  targetWindow: string;
}

/**
 * Intercepted route configuration list
 * Defines all routes that require special handling
 */
export const interceptRoutes: RouteInterceptConfig[] = [
  {
    description: 'Developer Tools',
    enabled: true,
    pathPrefix: '/desktop/devtools',
    targetWindow: 'devtools',
  },
  // Possible future routes
  // {
  //   description: 'Help Center',
  //   enabled: true,
  //   pathPrefix: '/help',
  //   targetWindow: 'help',
  // },
];

/**
 * Find matching route intercept configuration by path
 * @param path Path to check
 * @returns Matching intercept configuration, or undefined if no match found
 */
export const findMatchingRoute = (path: string): RouteInterceptConfig | undefined => {
  return interceptRoutes.find((route) => route.enabled && path.startsWith(route.pathPrefix));
};

/**
 * Extract sub-path from full path
 * @param fullPath Full path, e.g., '/settings/agent'
 * @param pathPrefix Path prefix, e.g., '/settings'
 * @returns Sub-path, e.g., 'agent'
 */
export const extractSubPath = (fullPath: string, pathPrefix: string): string | undefined => {
  if (fullPath.length <= pathPrefix.length) return undefined;

  // Remove leading slash
  const subPath = fullPath.slice(Math.max(0, pathPrefix.length + 1));
  return subPath || undefined;
};
