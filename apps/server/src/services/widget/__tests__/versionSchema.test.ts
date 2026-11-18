import { WIDGET_HTML_MAX_LENGTH } from '@lobechat/types';
import * as spec from '@lobechat/widget-spec';
import { describe, expect, it } from 'vitest';

import {
  widgetManifestSchema,
  widgetVersionContentSchema,
  widgetViewSchema,
} from '../versionSchema';

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

const script = 'console.log(JSON.stringify({ type: "stat", value: 1 }))';

/**
 * Drafts every entry point must judge the same way. The verdicts were taken
 * from the server's own schema before it moved to `@lobechat/widget-spec`, so
 * a change here is a change in what LobeHub accepts.
 */
const drafts: [name: string, draft: unknown, ok: boolean][] = [
  ['minimal stat draft', { outputType: 'stat', runtime: 'node', script }, true],
  [
    'full manifest',
    {
      changeNote: 'first cut',
      manifest: {
        description: 'Open issues',
        env: [
          {
            connector: 'github',
            inject: { header: 'Authorization', host: 'api.github.com', prefix: 'Bearer ' },
            name: 'GITHUB_TOKEN',
            required: true,
          },
        ],
        metric: { key: 'open_issues', kind: 'gauge', unit: 'issues', valuePath: 'value' },
        network: { allow: ['api.github.com'] },
        params: [{ default: 'lobehub/lobehub', name: 'REPO', required: true, type: 'string' }],
        schedule: { pattern: '*/30 * * * *', timezone: 'Asia/Shanghai' },
        timeoutMs: 30_000,
        title: 'Issues',
      },
      outputType: 'stat',
      runtime: 'python',
      script,
      view: { size: 'md' },
    },
    true,
  ],
  [
    'null manifest, view and note',
    { changeNote: null, manifest: null, outputType: 'table', runtime: 'bash', script, view: null },
    true,
  ],
  [
    'lowercase env name',
    { manifest: { env: [{ name: 'api_key' }] }, outputType: 'stat', runtime: 'node', script },
    true,
  ],
  [
    'env name with a leading digit',
    { manifest: { env: [{ name: '1KEY' }] }, outputType: 'stat', runtime: 'node', script },
    false,
  ],
  [
    'env name with a dash',
    { manifest: { env: [{ name: 'API-KEY' }] }, outputType: 'stat', runtime: 'node', script },
    false,
  ],
  ['unknown runtime', { outputType: 'stat', runtime: 'deno', script }, false],
  ['unknown output type', { outputType: 'chart', runtime: 'node', script }, false],
  ['empty script', { outputType: 'stat', runtime: 'node', script: '' }, false],
  [
    'script over 256 KiB',
    { outputType: 'stat', runtime: 'node', script: 'x'.repeat(256 * 1024 + 1) },
    false,
  ],
  [
    'change note over 500 chars',
    { changeNote: 'x'.repeat(501), outputType: 'stat', runtime: 'node', script },
    false,
  ],
  [
    'timeout over two minutes',
    { manifest: { timeoutMs: 120_001 }, outputType: 'stat', runtime: 'node', script },
    false,
  ],
  [
    'param named like an env requirement',
    {
      manifest: { env: [{ name: 'CITY' }], params: [{ name: 'CITY', type: 'string' }] },
      outputType: 'stat',
      runtime: 'node',
      script,
    },
    false,
  ],
  [
    'select param without options',
    {
      manifest: { params: [{ name: 'UNIT', type: 'select' }] },
      outputType: 'stat',
      runtime: 'node',
      script,
    },
    false,
  ],
  [
    'data layout with an unknown node key',
    {
      outputType: 'data',
      runtime: 'node',
      script,
      view: { layout: { type: 'text', value: 'hi', wat: 1 } },
    },
    false,
  ],
  [
    'unknown top-level keys are stripped',
    { extra: true, outputType: 'stat', runtime: 'node', script },
    true,
  ],
];

describe('widgetVersionContentSchema', () => {
  it('is the public widget-spec schema, not a server copy', () => {
    expect(widgetVersionContentSchema).toBe(spec.widgetVersionContentSchema);
    expect(widgetManifestSchema).toBe(spec.widgetManifestSchema);
    expect(widgetViewSchema).toBe(spec.widgetViewSchema);
  });

  it.each(drafts)('%s', (_name, draft, ok) => {
    expect(widgetVersionContentSchema.safeParse(draft).success).toBe(ok);
  });

  it('strips unknown keys and keeps the authored ones', () => {
    expect(
      widgetVersionContentSchema.parse({
        extra: true,
        outputType: 'stat',
        runtime: 'node',
        script,
      }),
    ).toEqual({ outputType: 'stat', runtime: 'node', script });
  });
});
