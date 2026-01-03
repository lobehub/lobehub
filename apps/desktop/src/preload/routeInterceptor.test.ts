/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invoke } from './invoke';

// Mock dependencies
vi.mock('./invoke', () => ({
  invoke: vi.fn(),
}));

vi.mock('~common/routes', () => ({
  findMatchingRoute: vi.fn(),
}));

const { findMatchingRoute } = await import('~common/routes');
const { setupRouteInterceptors } = await import('./routeInterceptor');

describe('setupRouteInterceptors', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock console methods
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Setup happy-dom window and document
    vi.stubGlobal('location', {
      href: 'http://localhost:3000/chat',
      origin: 'http://localhost:3000',
      pathname: '/chat',
    });

    // Clear existing event listeners by resetting document
    document.body.innerHTML = '';
  });

  describe('window.open interception', () => {
    it('should intercept external URL and invoke openExternalLink', () => {
      setupRouteInterceptors();

      const externalUrl = 'https://google.com';
      const result = window.open(externalUrl, '_blank');

      expect(invoke).toHaveBeenCalledWith('system.openExternalLink', externalUrl);
      expect(result).toBeNull();
    });

    it('should intercept URL object for external link', () => {
      setupRouteInterceptors();

      const externalUrl = new URL('https://github.com');
      const result = window.open(externalUrl, '_blank');

      expect(invoke).toHaveBeenCalledWith('system.openExternalLink', 'https://github.com/');
      expect(result).toBeNull();
    });

    it('should allow internal link to proceed with original window.open', () => {
      setupRouteInterceptors();

      const originalWindowOpen = window.open;
      const internalUrl = 'http://localhost:3000/settings';

      // We can't fully test the original behavior in happy-dom, but we can verify invoke is not called
      window.open(internalUrl);

      expect(invoke).not.toHaveBeenCalledWith('system.openExternalLink', expect.anything());
    });

    it('should handle relative URL that resolves as internal link', () => {
      setupRouteInterceptors();

      // In happy-dom, 'invalid-url' is resolved relative to window.location.href
      // So it becomes 'http://localhost:3000/invalid-url' which is internal
      const relativeUrl = 'invalid-url';
      window.open(relativeUrl);

      // Since it's internal, it won't call invoke for external link
      expect(invoke).not.toHaveBeenCalledWith('system.openExternalLink', expect.anything());
    });
  });

  describe('link click interception', () => {
    it('should intercept external link clicks', async () => {
      setupRouteInterceptors();

      const link = document.createElement('a');
      link.href = 'https://example.com';
      document.body.append(link);

      const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
      const preventDefaultSpy = vi.spyOn(clickEvent, 'preventDefault');
      const stopPropagationSpy = vi.spyOn(clickEvent, 'stopPropagation');

      link.dispatchEvent(clickEvent);

      // Wait for async handling
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(invoke).toHaveBeenCalledWith('system.openExternalLink', 'https://example.com/');
      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(stopPropagationSpy).toHaveBeenCalled();
    });

    it('should intercept internal link matching route pattern', async () => {
      setupRouteInterceptors();

      const matchedRoute = {
        description: 'Developer Tools',
        enabled: true,
        pathPrefix: '/desktop/devtools',
        targetWindow: 'devtools',
      };
      vi.mocked(findMatchingRoute).mockReturnValue(matchedRoute);

      const link = document.createElement('a');
      link.href = 'http://localhost:3000/desktop/devtools';
      document.body.append(link);

      const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
      const preventDefaultSpy = vi.spyOn(clickEvent, 'preventDefault');

      link.dispatchEvent(clickEvent);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(findMatchingRoute).toHaveBeenCalledWith('/desktop/devtools');
      expect(invoke).toHaveBeenCalledWith('windows.interceptRoute', {
        path: '/desktop/devtools',
        source: 'link-click',
        url: 'http://localhost:3000/desktop/devtools',
      });
      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it('should not intercept if already on target page', async () => {
      setupRouteInterceptors();

      // Set current location to be in the target page
      vi.stubGlobal('location', {
        href: 'http://localhost:3000/desktop/devtools/console',
        origin: 'http://localhost:3000',
        pathname: '/desktop/devtools/console',
      });

      const matchedRoute = {
        description: 'Developer Tools',
        enabled: true,
        pathPrefix: '/desktop/devtools',
        targetWindow: 'devtools',
      };
      vi.mocked(findMatchingRoute).mockReturnValue(matchedRoute);

      const link = document.createElement('a');
      link.href = 'http://localhost:3000/desktop/devtools/network';
      document.body.append(link);

      const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
      const preventDefaultSpy = vi.spyOn(clickEvent, 'preventDefault');

      link.dispatchEvent(clickEvent);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(preventDefaultSpy).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalledWith('windows.interceptRoute', expect.anything());
    });

    it('should handle non-HTTP link protocols as external links', async () => {
      setupRouteInterceptors();

      const link = document.createElement('a');
      link.href = 'mailto:test@example.com';
      document.body.append(link);

      const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
      const preventDefaultSpy = vi.spyOn(clickEvent, 'preventDefault');

      link.dispatchEvent(clickEvent);

      await new Promise((resolve) => setTimeout(resolve, 0));

      // mailto: links are treated as external links by the URL constructor
      expect(invoke).toHaveBeenCalledWith('system.openExternalLink', 'mailto:test@example.com');
      expect(preventDefaultSpy).toHaveBeenCalled();
    });
  });

  describe('history.pushState interception', () => {
    it('should intercept pushState for matched routes', () => {
      setupRouteInterceptors();

      const matchedRoute = {
        description: 'Developer Tools',
        enabled: true,
        pathPrefix: '/desktop/devtools',
        targetWindow: 'devtools',
      };
      vi.mocked(findMatchingRoute).mockReturnValue(matchedRoute);

      const originalLength = history.length;
      history.pushState({}, '', '/desktop/devtools');

      expect(findMatchingRoute).toHaveBeenCalledWith('/desktop/devtools');
      expect(invoke).toHaveBeenCalledWith('windows.interceptRoute', {
        path: '/desktop/devtools',
        source: 'push-state',
        url: 'http://localhost:3000/desktop/devtools',
      });
      // Ensure navigation was prevented
      expect(history.length).toBe(originalLength);
    });

    it('should not intercept if already on target page', () => {
      setupRouteInterceptors();

      vi.stubGlobal('location', {
        href: 'http://localhost:3000/desktop/devtools/console',
        origin: 'http://localhost:3000',
        pathname: '/desktop/devtools/console',
      });

      const matchedRoute = {
        description: 'Developer Tools',
        enabled: true,
        pathPrefix: '/desktop/devtools',
        targetWindow: 'devtools',
      };
      vi.mocked(findMatchingRoute).mockReturnValue(matchedRoute);

      history.pushState({}, '', '/desktop/devtools/network');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Skip pushState interception'),
      );
    });

    it('should allow pushState for non-matched routes', () => {
      setupRouteInterceptors();

      vi.mocked(findMatchingRoute).mockReturnValue(undefined);

      history.pushState({}, '', '/chat/new');

      expect(invoke).not.toHaveBeenCalledWith('windows.interceptRoute', expect.anything());
    });

    it('should handle pushState errors gracefully', () => {
      setupRouteInterceptors();

      vi.mocked(findMatchingRoute).mockImplementation(() => {
        throw new Error('Route matching error');
      });

      history.pushState({}, '', '/some/path');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('pushState interception error'),
        expect.any(Error),
      );
    });
  });

  describe('history.replaceState interception', () => {
    it('should intercept replaceState for matched routes', () => {
      setupRouteInterceptors();

      const matchedRoute = {
        description: 'Developer Tools',
        enabled: true,
        pathPrefix: '/desktop/devtools',
        targetWindow: 'devtools',
      };
      vi.mocked(findMatchingRoute).mockReturnValue(matchedRoute);

      history.replaceState({}, '', '/desktop/devtools');

      expect(findMatchingRoute).toHaveBeenCalledWith('/desktop/devtools');
      expect(invoke).toHaveBeenCalledWith('windows.interceptRoute', {
        path: '/desktop/devtools',
        source: 'replace-state',
        url: 'http://localhost:3000/desktop/devtools',
      });
    });

    it('should not intercept if already on target page', () => {
      setupRouteInterceptors();

      vi.stubGlobal('location', {
        href: 'http://localhost:3000/desktop/devtools/console',
        origin: 'http://localhost:3000',
        pathname: '/desktop/devtools/console',
      });

      const matchedRoute = {
        description: 'Developer Tools',
        enabled: true,
        pathPrefix: '/desktop/devtools',
        targetWindow: 'devtools',
      };
      vi.mocked(findMatchingRoute).mockReturnValue(matchedRoute);

      history.replaceState({}, '', '/desktop/devtools/network');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Skip replaceState interception'),
      );
    });

    it('should allow replaceState for non-matched routes', () => {
      setupRouteInterceptors();

      vi.mocked(findMatchingRoute).mockReturnValue(undefined);

      history.replaceState({}, '', '/chat/session-123');

      expect(invoke).not.toHaveBeenCalledWith('windows.interceptRoute', expect.anything());
    });
  });

  describe('error event interception', () => {
    it('should prevent navigation errors for prevented paths', () => {
      setupRouteInterceptors();

      // First trigger a route interception to add path to preventedPaths
      const matchedRoute = {
        description: 'Developer Tools',
        enabled: true,
        pathPrefix: '/desktop/devtools',
        targetWindow: 'devtools',
      };
      vi.mocked(findMatchingRoute).mockReturnValue(matchedRoute);
      history.pushState({}, '', '/desktop/devtools');

      // Now trigger an error event with navigation in the message
      const errorEvent = new ErrorEvent('error', {
        bubbles: true,
        cancelable: true,
        message: 'navigation error occurred',
      });
      const preventDefaultSpy = vi.spyOn(errorEvent, 'preventDefault');

      window.dispatchEvent(errorEvent);

      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Captured possible routing error'),
      );
    });

    it('should not prevent non-navigation errors', () => {
      setupRouteInterceptors();

      const errorEvent = new ErrorEvent('error', {
        bubbles: true,
        cancelable: true,
        message: 'some other error',
      });
      const preventDefaultSpy = vi.spyOn(errorEvent, 'preventDefault');

      window.dispatchEvent(errorEvent);

      expect(preventDefaultSpy).not.toHaveBeenCalled();
    });
  });

  describe('interceptRoute helper', () => {
    it('should handle successful route interception', async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);

      setupRouteInterceptors();

      const matchedRoute = {
        description: 'Developer Tools',
        enabled: true,
        pathPrefix: '/desktop/devtools',
        targetWindow: 'devtools',
      };
      vi.mocked(findMatchingRoute).mockReturnValue(matchedRoute);

      history.pushState({}, '', '/desktop/devtools');

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(invoke).toHaveBeenCalledWith('windows.interceptRoute', {
        path: '/desktop/devtools',
        source: 'push-state',
        url: 'http://localhost:3000/desktop/devtools',
      });
    });

    it('should handle route interception errors gracefully', async () => {
      const error = new Error('IPC communication failed');
      vi.mocked(invoke).mockRejectedValue(error);

      setupRouteInterceptors();

      const matchedRoute = {
        description: 'Developer Tools',
        enabled: true,
        pathPrefix: '/desktop/devtools',
        targetWindow: 'devtools',
      };
      vi.mocked(findMatchingRoute).mockReturnValue(matchedRoute);

      history.pushState({}, '', '/desktop/devtools');

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Route interception (push-state) call failed'),
        error,
      );
    });
  });
});
