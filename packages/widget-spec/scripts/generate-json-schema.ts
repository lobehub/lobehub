/**
 * Writes the widget contract as JSON Schema to `schema/<name>.schema.json`.
 *
 *   bun scripts/generate-json-schema.ts           # regenerate
 *   bun scripts/generate-json-schema.ts --check   # fail when a file is stale
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { WIDGET_JSON_SCHEMA_NAMES, widgetJsonSchema } from '../src/jsonSchema';

const outDir = path.resolve(import.meta.dirname, '../schema');
const check = process.argv.includes('--check');

// Compared parsed, not as text: the repo formatter rewraps and reorders the committed JSON.
const readJson = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
};

const stale: string[] = [];
mkdirSync(outDir, { recursive: true });

for (const name of WIDGET_JSON_SCHEMA_NAMES) {
  const file = path.join(outDir, `${name}.schema.json`);
  const schema = widgetJsonSchema(name);
  const content = `${JSON.stringify(schema, null, 2)}\n`;
  if (isDeepStrictEqual(readJson(file), schema)) continue;
  if (check) stale.push(path.relative(process.cwd(), file));
  else writeFileSync(file, content);
}

if (stale.length > 0) {
  console.error(
    `Stale widget JSON Schema: ${stale.join(', ')}\nRun: bun run --cwd packages/widget-spec generate`,
  );
  process.exit(1);
}
