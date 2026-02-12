import { findMatchingRoute } from '~common/routes';

import { invoke } from './invoke';

const interceptRoute = async (path: string, source: 'link-click', url: string) => {
  console.log(`[preload] Intercepted ${source} and prevented default behavior:`, path);

  // Use electron-client-ipc's dispatch method
  try {
    await invoke('windows.interceptRoute', { path, source, url });
  } catch (e) {
    console.error(`[preload] Route interception (${source}) call failed`, e);
  }
};

/**
 * Route interceptor - Responsible for capturing and intercepting client-side route navigation
 */
export const setupRouteInterceptors = function () {
  console.log('[preload] Setting up route interceptors');

  // Intercept all a tag click events - For Next.js Link component
  document.addEventListener(
    'click',
    async (e) => {
      const link = (e.target as HTMLElement).closest('a');
      if (link && link.href) {
        try {
          const url = new URL(link.href);

          // Check if it's an external link
          if (url.origin !== window.location.origin) {
            console.log(`[preload] Intercepted external link click:`, url.href);
            // Prevent default link navigation behavior
            e.preventDefault();
            e.stopPropagation();
            // Call main process to handle external link
            await invoke('system.openExternalLink', url.href);
            return false; // Explicitly prevent subsequent processing
          }

          // If not external link, continue with internal route interception logic
          // Use shared config to check if interception is needed
          const matchedRoute = findMatchingRoute(url.pathname);

          // If it's a path that needs interception
          if (matchedRoute) {
            const currentPath = window.location.pathname;
            const isAlreadyInTargetPage = currentPath.startsWith(matchedRoute.pathPrefix);

            // If already in target page, don't intercept, let default navigation continue
            if (isAlreadyInTargetPage) return;

            // Immediately prevent default behavior to avoid Next.js taking over routing
            e.preventDefault();
            e.stopPropagation();

            await interceptRoute(url.pathname, 'link-click', link.href);

            return false;
          }
        } catch (err) {
          // Handle possible URL parsing errors or other issues
          // For example mailto:, tel: protocols will cause new URL() to throw error
          if (err instanceof TypeError && err.message.includes('Invalid URL')) {
            console.log(
              '[preload] Non-HTTP link clicked, allowing default browser behavior:',
              link.href,
            );
            // For non-HTTP/HTTPS links, allow browser default handling
            // No need for e.preventDefault() or invoke
          } else {
            console.error('[preload] Link interception error:', err);
          }
        }
      }
    },
    true,
  );

  console.log('[preload] Route interceptors setup completed');
};
