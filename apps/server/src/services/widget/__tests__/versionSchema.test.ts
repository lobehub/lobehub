import { WIDGET_HTML_MAX_LENGTH } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { widgetManifestSchema, widgetViewSchema } from '../versionSchema';

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

describe('widgetViewSchema html', () => {
  it('accepts a document up to the size limit', () => {
    expect(widgetViewSchema.safeParse({ html: '<svg></svg>' }).success).toBe(true);
    expect(widgetViewSchema.safeParse({ html: 'x'.repeat(WIDGET_HTML_MAX_LENGTH) }).success).toBe(
      true,
    );
  });

  it.each([[''], ['x'.repeat(WIDGET_HTML_MAX_LENGTH + 1)], [42]])('rejects %#', (html) => {
    expect(widgetViewSchema.safeParse({ html }).success).toBe(false);
  });
});
