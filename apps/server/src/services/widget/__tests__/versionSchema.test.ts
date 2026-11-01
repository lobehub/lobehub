import { describe, expect, it } from 'vitest';

import { widgetManifestSchema } from '../versionSchema';

const withInject = (inject: unknown) =>
  widgetManifestSchema.safeParse({ env: [{ connector: 'github', inject, name: 'GITHUB_TOKEN' }] });

describe('widgetManifestSchema env[].inject', () => {
  it('accepts a host, a host list and wildcard hosts', () => {
    expect(withInject({ host: 'api.github.com' }).success).toBe(true);
    expect(
      withInject({ header: 'X-Api-Key', host: ['us.posthog.com', '*.posthog.com'], prefix: '' })
        .success,
    ).toBe(true);
  });

  it.each([
    [{ host: 'https://api.github.com' }],
    [{ host: 'api.github.com/repos' }],
    [{ host: [] }],
    [{ header: 'Bad Header', host: 'api.github.com' }],
    [{ host: 'api.github.com', prefix: 'Bearer \r\nX-Evil: 1' }],
  ])('rejects %o', (inject) => {
    expect(withInject(inject).success).toBe(false);
  });
});
