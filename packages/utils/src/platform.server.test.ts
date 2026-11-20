// @vitest-environment node
import { expect, it } from 'vitest';

import { isArc } from './platform';

it('reports no Arc browser on the server without accessing browser globals', () => {
  expect(isArc()).toBe(false);
});
