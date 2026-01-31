export interface InterceptRouteParams {
  /**
   * Request path
   */
  path: string;
  /**
   * Source type: 'link-click', 'push-state', 'replace-state'
   */
  source: 'link-click' | 'push-state' | 'replace-state';
  /**
   * Full URL
   */
  url: string;
}

export interface InterceptRouteResponse {
  /**
   * Error message (if any)
   */
  error?: string;

  /**
   * Whether intercepted
   */
  intercepted: boolean;

  /**
   * Original path
   */
  path: string;

  /**
   * Original source
   */
  source: string;

  /**
   * Sub path (if any)
   */
  subPath?: string;

  /**
   * Target window identifier
   */
  targetWindow?: string;
}
