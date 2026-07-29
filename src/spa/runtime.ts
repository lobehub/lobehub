import type { RootOptions } from 'react-dom/client';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';

type BrowserRouterFactory = typeof createBrowserRouter;

export interface SPARuntimeInstrumentation {
  createBrowserRouter?: BrowserRouterFactory;
  rootOptions?: RootOptions;
}

let runtimeInstrumentation: SPARuntimeInstrumentation = {};

export const configureSPARuntimeInstrumentation = (instrumentation: SPARuntimeInstrumentation) => {
  runtimeInstrumentation = {
    ...runtimeInstrumentation,
    ...instrumentation,
    rootOptions: {
      ...runtimeInstrumentation.rootOptions,
      ...instrumentation.rootOptions,
    },
  };
};

export const createSPABrowserRouter = (...args: Parameters<BrowserRouterFactory>) =>
  (runtimeInstrumentation.createBrowserRouter ?? createBrowserRouter)(...args);

export const createSPARoot = (container: Parameters<typeof createRoot>[0]) =>
  createRoot(container, runtimeInstrumentation.rootOptions);
