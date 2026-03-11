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

      const link = document.createElement('a');
      link.href = 'http://localhost:3000/desktop/devtools';
      document.body.append(link);

      const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
      link.dispatchEvent(clickEvent);

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(invoke).toHaveBeenCalledWith('windows.interceptRoute', {
        path: '/desktop/devtools',
        source: 'link-click',
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

      const link = document.createElement('a');
      link.href = 'http://localhost:3000/desktop/devtools';
      document.body.append(link);

      const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
      link.dispatchEvent(clickEvent);

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Route interception (link-click) call failed'),
        error,
      );
    });
  });
});
