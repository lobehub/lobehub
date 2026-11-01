/** @vitest-environment node */
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { describe, expect, it, vi } from 'vitest';

import { config } from './proxy';

vi.mock('@/libs/next/proxy/define-config', () => ({
  defineConfig: () => ({ middleware: vi.fn() }),
}));

describe('SPA proxy route matching', () => {
  it.each(['/a/shared-agent', '/a/e2e-missing-share', '/a/shared-agent?hl=en-US'])(
    'routes %s through the SPA proxy',
    (pathname) => {
      expect(
        unstable_doesMiddlewareMatch({ config, url: `http://localhost:3010${pathname}` }),
      ).toBe(true);
    },
  );

  it.each(['/api/chat', '/trpc/lambda/share.getSharedAgent', '/webapi/chat'])(
    'keeps backend authentication in the handler for %s',
    (pathname) => {
      expect(
        unstable_doesMiddlewareMatch({ config, url: `http://localhost:3010${pathname}` }),
      ).toBe(false);
    },
  );
});
