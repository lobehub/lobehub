import { findMatchingRoute } from '~common/routes';

import { invoke } from './invoke';

const interceptRoute = async (
  path: string,
  source: 'link-click' | 'push-state' | 'replace-state',
  url: string,
) => {
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

  // Store prevented paths to avoid pushState duplicate triggers
  const preventedPaths = new Set<string>();

  // Override window.open method to intercept JavaScript calls
  const originalWindowOpen = window.open;
  window.open = function (url?: string | URL, target?: string, features?: string) {
    if (url) {
      try {
        const urlString = typeof url === 'string' ? url : url.toString();
        const urlObj = new URL(urlString, window.location.href);

        // Check if it's an external link
        if (urlObj.origin !== window.location.origin) {
          console.log(`[preload] Intercepted window.open for external URL:`, urlString);
          // Call main process to handle external link
          invoke('system.openExternalLink', urlString);
          return null; // Return null to indicate no window was opened
        }
      } catch (error) {
        // Handle invalid URL or special protocol
        console.error(`[preload] Intercepted window.open for special protocol:`, url);
        console.error(error);
        invoke('system.openExternalLink', typeof url === 'string' ? url : url.toString());
        return null;
      }
    }

    // For internal links, call original window.open
    return originalWindowOpen.call(window, url, target, features);
  };

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

  // Intercept history API (for capturing Next.js useRouter().push/replace etc.)
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  // Override pushState
  history.pushState = function () {
    const url = arguments[2];
    if (typeof url === 'string') {
      try {
        // Only handle relative paths or current domain URLs
        const parsedUrl = new URL(url, window.location.origin);

        // Use shared config to check if interception is needed
        const matchedRoute = findMatchingRoute(parsedUrl.pathname);

        // Check if this navigation needs interception
        if (matchedRoute) {
          // Check if current page is already under target path, if so don't intercept
          const currentPath = window.location.pathname;
          const isAlreadyInTargetPage = currentPath.startsWith(matchedRoute.pathPrefix);

          // If already in target page, don't intercept, let default navigation continue
          if (isAlreadyInTargetPage) {
            console.log(
              `[preload] Skip pushState interception for ${parsedUrl.pathname} because already in target page ${matchedRoute.pathPrefix}`,
            );
            return Reflect.apply(originalPushState, this, arguments);
          }

          // Add this path to prevented set
          preventedPaths.add(parsedUrl.pathname);

          interceptRoute(parsedUrl.pathname, 'push-state', parsedUrl.href);

          // Don't execute original pushState operation, prevent navigation
          // But return undefined to avoid errors
          return;
        }
      } catch (err) {
        console.error('[preload] pushState interception error:', err);
      }
    }
    return Reflect.apply(originalPushState, this, arguments);
  };

  // Override replaceState
  history.replaceState = function () {
    const url = arguments[2];
    if (typeof url === 'string') {
      try {
        const parsedUrl = new URL(url, window.location.origin);

        // Use shared config to check if interception is needed
        const matchedRoute = findMatchingRoute(parsedUrl.pathname);

        // Check if this navigation needs interception
        if (matchedRoute) {
          // Check if current page is already under target path, if so don't intercept
          const currentPath = window.location.pathname;
          const isAlreadyInTargetPage = currentPath.startsWith(matchedRoute.pathPrefix);

          // If already in target page, don't intercept, let default navigation continue
          if (isAlreadyInTargetPage) {
            console.log(
              `[preload] Skip replaceState interception for ${parsedUrl.pathname} because already in target page ${matchedRoute.pathPrefix}`,
            );
            return Reflect.apply(originalReplaceState, this, arguments);
          }

          // Add to prevented set
          preventedPaths.add(parsedUrl.pathname);

          interceptRoute(parsedUrl.pathname, 'replace-state', parsedUrl.href);

          // Prevent navigation
          return;
        }
      } catch (err) {
        console.error('[preload] replaceState interception error:', err);
      }
    }
    return Reflect.apply(originalReplaceState, this, arguments);
  };

  // Listen and intercept routing errors - Sometimes Next.js tries to recover navigation on routing errors
  window.addEventListener(
    'error',
    function (e) {
      if (e.message && e.message.includes('navigation') && preventedPaths.size > 0) {
        console.log('[preload] Captured possible routing error, preventing default behavior');
        e.preventDefault();
      }
    },
    true,
  );

  console.log('[preload] Route interceptors setup completed');
};
