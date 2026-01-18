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
    description: '开发者工具',
    enabled: true,
    pathPrefix: '/desktop/devtools',
    targetWindow: 'devtools',
  },
  // 未来可能的其他路由
  // {
  //   description: '帮助中心',
  //   enabled: true,
  //   pathPrefix: '/help',
  //   targetWindow: 'help',
  // },
];

/**
 * 通过路径查找匹配的路由拦截配置
 * @param path 需要检查的路径
 * @returns 匹配的拦截配置，如果没有匹配则返回 undefined
 */
export const findMatchingRoute = (path: string): RouteInterceptConfig | undefined => {
  return interceptRoutes.find((route) => route.enabled && path.startsWith(route.pathPrefix));
};

/**
 * 从完整路径中提取子路径
 * @param fullPath 完整路径，如 '/settings/agent'
 * @param pathPrefix 路径前缀，如 '/settings'
 * @returns 子路径，如 'agent'
 */
export const extractSubPath = (fullPath: string, pathPrefix: string): string | undefined => {
  if (fullPath.length <= pathPrefix.length) return undefined;

  // 去除前导斜杠
  const subPath = fullPath.slice(Math.max(0, pathPrefix.length + 1));
  return subPath || undefined;
};
