import { createBrowserRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import {
  configureSPARuntimeInstrumentation,
  createSPABrowserRouter,
  createSPARoot,
} from './runtime';

const { createRoot } = vi.hoisted(() => ({ createRoot: vi.fn() }));

vi.mock('react-dom/client', () => ({ createRoot }));

describe('SPA runtime instrumentation', () => {
  it('applies registered router and React root instrumentation', () => {
    const root = { render: vi.fn(), unmount: vi.fn() };
    const rootErrorHandler = vi.fn();
    let routerCalls = 0;
    const instrumentedCreateBrowserRouter: typeof createBrowserRouter = (...args) => {
      routerCalls += 1;
      return createBrowserRouter(...args);
    };

    createRoot.mockReturnValue(root);
    configureSPARuntimeInstrumentation({
      createBrowserRouter: instrumentedCreateBrowserRouter,
      rootOptions: {
        onCaughtError: rootErrorHandler,
        onRecoverableError: rootErrorHandler,
        onUncaughtError: rootErrorHandler,
      },
    });

    const container = document.createElement('div');
    expect(createSPARoot(container)).toBe(root);
    expect(createRoot).toHaveBeenCalledWith(container, {
      onCaughtError: rootErrorHandler,
      onRecoverableError: rootErrorHandler,
      onUncaughtError: rootErrorHandler,
    });

    const router = createSPABrowserRouter([{ element: null, path: '/' }]);
    expect(router).toBeDefined();
    expect(routerCalls).toBe(1);
  });
});
