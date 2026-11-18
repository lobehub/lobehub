import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';

import {
  BUILTIN_WIDGET_PRESETS,
  WIDGET_JSON_SCHEMA_NAMES,
  widgetJsonSchema,
  widgetManifestSchema,
  widgetOutputSchema,
  widgetVersionContentSchema,
} from './index';

const packageDir = path.resolve(import.meta.dirname, '..');
const committed = (name: string) =>
  JSON.parse(readFileSync(path.join(packageDir, 'schema', `${name}.schema.json`), 'utf8'));

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validator = (name: (typeof WIDGET_JSON_SCHEMA_NAMES)[number]) =>
  ajv.compile(widgetJsonSchema(name));

describe('published JSON Schema', () => {
  it.each(WIDGET_JSON_SCHEMA_NAMES)('schema/%s.schema.json matches the zod schema', (name) => {
    // Stale files mean `bun run --cwd packages/widget-spec generate` was not run.
    expect(committed(name)).toEqual(widgetJsonSchema(name));
  });

  it('publishes a file for every schema and nothing else', () => {
    const files = readdirSync(path.join(packageDir, 'schema')).sort();
    expect(files).toEqual(WIDGET_JSON_SCHEMA_NAMES.map((name) => `${name}.schema.json`).sort());
  });

  it.each(WIDGET_JSON_SCHEMA_NAMES)('%s compiles as draft 2020-12', (name) => {
    expect(widgetJsonSchema(name).$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(() => validator(name)).not.toThrow();
  });
});

const script = 'print("{}")';
const base = { outputType: 'stat', runtime: 'python', script } as const;

/**
 * Shape rules both validators must agree on. Cross-field rules (duplicate
 * params, selects without options, unique series) are zod-only and listed in
 * `zodOnly` below.
 */
const drafts: [name: string, draft: unknown][] = [
  ['minimal draft', base],
  ['nullable manifest and view', { ...base, changeNote: null, manifest: null, view: null }],
  ['lowercase env name', { ...base, manifest: { env: [{ name: 'api_key' }] } }],
  ['env name with a leading digit', { ...base, manifest: { env: [{ name: '1KEY' }] } }],
  [
    'inject host with a scheme',
    { ...base, manifest: { env: [{ inject: { host: 'https://x.com' }, name: 'T' }] } },
  ],
  [
    'inject header with a space',
    { ...base, manifest: { env: [{ inject: { header: 'X Key', host: 'x.com' }, name: 'T' }] } },
  ],
  [
    'wildcard inject hosts',
    { ...base, manifest: { env: [{ inject: { host: ['*.x.com'] }, name: 'T' }] } },
  ],
  ['network allow list', { ...base, manifest: { network: { allow: ['api.github.com'] } } }],
  ['schedule', { ...base, manifest: { schedule: { pattern: '0 * * * *', timezone: 'UTC' } } }],
  ['metric', { ...base, manifest: { metric: { key: 'stars', kind: 'counter' } } }],
  ['metric without a key', { ...base, manifest: { metric: { unit: 'x' } } }],
  ['timeout over two minutes', { ...base, manifest: { timeoutMs: 120_001 } }],
  ['fractional timeout', { ...base, manifest: { timeoutMs: 1.5 } }],
  ['unknown runtime', { ...base, runtime: 'ruby' }],
  ['unknown output type', { ...base, outputType: 'chart' }],
  ['empty script', { ...base, script: '' }],
  ['long change note', { ...base, changeNote: 'x'.repeat(501) }],
  [
    'param with a lowercase name',
    { ...base, manifest: { params: [{ name: 'city', type: 'string' }] } },
  ],
  [
    'layout with an unknown node key',
    { ...base, view: { layout: { type: 'text', value: 'a', x: 1 } } },
  ],
  ['layout with an unknown node type', { ...base, view: { layout: { type: 'chart' } } }],
  [
    'nested layout',
    {
      ...base,
      view: {
        layout: {
          children: [
            {
              items: 'data.rows',
              template: { type: 'text', value: { bind: 'item.t' } },
              type: 'repeat',
            },
          ],
          type: 'stack',
        },
        surface: { bind: 'data.cond', map: { '*': 'sky' } },
      },
    },
  ],
];

describe('JSON Schema agrees with zod', () => {
  const validate = validator('version-content');

  it.each(drafts)('%s', (_name, draft) => {
    expect(validate(draft)).toBe(widgetVersionContentSchema.safeParse(draft).success);
  });

  it('leaves cross-field rules to zod', () => {
    const zodOnly = {
      ...base,
      manifest: { env: [{ name: 'CITY' }], params: [{ name: 'CITY', type: 'string' }] },
    };
    expect(validate(zodOnly)).toBe(true);
    expect(widgetManifestSchema.safeParse(zodOnly.manifest).success).toBe(false);
  });

  it('accepts every built-in preset and its sample output', () => {
    const preset = validator('preset');
    const output = validator('output');
    for (const p of BUILTIN_WIDGET_PRESETS) {
      expect(preset(p), `${p.id}: ${ajv.errorsText(preset.errors)}`).toBe(true);
      expect(output(p.sample)).toBe(widgetOutputSchema.safeParse(p.sample).success);
    }
  });
});

describe('package boundary', () => {
  it('imports only the widget slice of @lobechat/types, so the build can inline it', () => {
    const sources = readdirSync(path.join(packageDir, 'src'), { recursive: true })
      .map(String)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'));
    for (const file of sources) {
      const text = readFileSync(path.join(packageDir, 'src', file), 'utf8');
      const imports = [...text.matchAll(/from '(@lobechat\/[^']+)'/g)].map((m) => m[1]);
      expect(
        imports.filter((name) => name !== '@lobechat/types/widget'),
        file,
      ).toEqual([]);
    }
  });
});
