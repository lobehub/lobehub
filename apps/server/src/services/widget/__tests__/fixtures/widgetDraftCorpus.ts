/**
 * Drafts every entry point that records a widget version must judge the same
 * way. `legacyVerdicts.json` holds what the server's own schema returned for
 * each, recorded at 098d09ec46 — before the schema moved to `@lobechat/widget-spec`.
 */
const script = 'console.log(JSON.stringify({ type: "stat", value: 1 }))';
const base = { outputType: 'stat', runtime: 'node', script } as const;
const withManifest = (manifest: unknown) => ({ ...base, manifest });

export const widgetDraftCorpus: Record<string, unknown> = {
  // Accepted shapes
  'minimal stat draft': base,
  'full manifest': {
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
  'null manifest, view and note': {
    ...base,
    changeNote: null,
    manifest: null,
    runtime: 'bash',
    view: null,
  },
  'unknown keys are stripped': { ...base, extra: true, manifest: { extra: 1 } },

  // Required fields
  'missing script': { outputType: 'stat', runtime: 'node' },
  'missing runtime': { outputType: 'stat', script },
  'missing outputType': { runtime: 'node', script },
  'not an object': 'console.log(1)',

  // runtime / outputType enums
  'runtime python': { ...base, runtime: 'python' },
  'runtime bash': { ...base, runtime: 'bash' },
  'unknown runtime': { ...base, runtime: 'deno' },
  'outputType list': { ...base, outputType: 'list' },
  'outputType series': { ...base, outputType: 'series' },
  'outputType table': { ...base, outputType: 'table' },
  'outputType data': { ...base, outputType: 'data' },
  'unknown outputType': { ...base, outputType: 'chart' },

  // script / changeNote bounds
  'empty script': { ...base, script: '' },
  'script at 256 KiB': { ...base, script: 'x'.repeat(256 * 1024) },
  'script over 256 KiB': { ...base, script: 'x'.repeat(256 * 1024 + 1) },
  'change note at 500 chars': { ...base, changeNote: 'x'.repeat(500) },
  'change note over 500 chars': { ...base, changeNote: 'x'.repeat(501) },

  // network allow-list
  'empty network allow list': withManifest({ network: { allow: [] } }),
  'wildcard network host': withManifest({ network: { allow: ['*.posthog.com'] } }),
  'empty network host': withManifest({ network: { allow: [''] } }),
  'network host at 253 chars': withManifest({ network: { allow: ['a'.repeat(253)] } }),
  'network host over 253 chars': withManifest({ network: { allow: ['a'.repeat(254)] } }),
  '50 network hosts': withManifest({
    network: { allow: Array.from({ length: 50 }, (_, i) => `h${i}.example.com`) },
  }),
  '51 network hosts': withManifest({
    network: { allow: Array.from({ length: 51 }, (_, i) => `h${i}.example.com`) },
  }),
  'network without allow': withManifest({ network: {} }),

  // env credentials
  'lowercase env name': withManifest({ env: [{ name: 'api_key' }] }),
  'mixed-case env name': withManifest({ env: [{ name: '_Api_Key2' }] }),
  'env name with a leading digit': withManifest({ env: [{ name: '1KEY' }] }),
  'env name with a dash': withManifest({ env: [{ name: 'API-KEY' }] }),
  'non-ASCII env name': withManifest({ env: [{ name: 'KelvinK' }] }),
  'inject host list with wildcard': withManifest({
    env: [{ inject: { host: ['us.posthog.com', '*.posthog.com'] }, name: 'T' }],
  }),
  'inject host with a scheme': withManifest({
    env: [{ inject: { host: 'https://api.github.com' }, name: 'T' }],
  }),
  'inject header with a space': withManifest({
    env: [{ inject: { header: 'Bad Header', host: 'api.github.com' }, name: 'T' }],
  }),
  'inject prefix with a newline': withManifest({
    env: [{ inject: { host: 'api.github.com', prefix: 'Bearer \r\nX: 1' }, name: 'T' }],
  }),
  '21 env entries': withManifest({
    env: Array.from({ length: 21 }, (_, i) => ({ name: `K${i}` })),
  }),

  // params
  'param named like an env requirement': withManifest({
    env: [{ name: 'CITY' }],
    params: [{ name: 'CITY', type: 'string' }],
  }),
  'duplicate param': withManifest({
    params: [
      { name: 'CITY', type: 'string' },
      { name: 'CITY', type: 'string' },
    ],
  }),
  'select param without options': withManifest({ params: [{ name: 'UNIT', type: 'select' }] }),
  'date param with a bad default': withManifest({
    params: [{ default: '2026/01/01', name: 'DAY', type: 'date' }],
  }),

  // schedule / metric / timeout
  'schedule without pattern': withManifest({ schedule: { timezone: 'UTC' } }),
  'metric without key': withManifest({ metric: { unit: 'x' } }),
  'metric with unknown kind': withManifest({ metric: { key: 'k', kind: 'histogram' } }),
  'timeout at two minutes': withManifest({ timeoutMs: 120_000 }),
  'timeout over two minutes': withManifest({ timeoutMs: 120_001 }),
  'fractional timeout': withManifest({ timeoutMs: 1.5 }),

  // view
  'html view': { ...base, view: { html: '<svg></svg>' } },
  'data layout': {
    ...base,
    outputType: 'data',
    view: {
      layout: {
        children: [{ type: 'text', value: { bind: 'data.temp', format: 'number' } }],
        type: 'stack',
      },
      surface: { bind: 'data.cond', map: { '*': 'sky' } },
    },
  },
  'layout with an unknown node key': {
    ...base,
    outputType: 'data',
    view: { layout: { type: 'text', value: 'hi', wat: 1 } },
  },
};

interface ParseResult {
  data?: unknown;
  error?: { issues: { code: string; message: string; path: PropertyKey[] }[] };
  success: boolean;
}

/** Long strings (a 256 KiB script) are recorded by length, not content. */
const shorten = (value: unknown): unknown => {
  if (typeof value === 'string') return value.length > 200 ? `<${value.length} chars>` : value;
  if (Array.isArray(value)) return value.map(shorten);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, shorten(v)]));
  }
  return value;
};

/** What a parse decided: the parsed draft, or every issue with its path and message. */
export const summarizeParse = (result: ParseResult) =>
  result.success
    ? { data: shorten(result.data), success: true }
    : {
        issues: result.error!.issues.map(({ code, message, path }) => ({
          code,
          message,
          path: path.map(String),
        })),
        success: false,
      };
