import { matchRoutes } from 'react-router-dom';
import { expect, it } from 'vitest';

import { electronRoutes, webRoutes } from './routes';

it.each([
  ['Web', webRoutes],
  ['Electron', electronRoutes],
])('%s leaves the visitor surface to the deployment that owns its accounting', (_, routes) => {
  // This shell must delegate visitor conversations to the deployment's business slot,
  // because that deployment owns charging the creator's account for the visitor's usage.
  // The base shell intentionally has no visitor registration of its own.
  expect(matchRoutes(routes, '/a/example')?.at(-1)?.route.path).toBe('*');
});
