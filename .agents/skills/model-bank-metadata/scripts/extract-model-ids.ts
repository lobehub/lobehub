/**
 * Extract unique normalized chat-model ids from packages/model-bank/src/aiModels/*.ts.
 * Normalization: last path segment, lowercased (matches the apply codemods).
 *
 * Usage (repo root): bun .agents/skills/model-bank-metadata/scripts/extract-model-ids.ts [out.json]
 * Default output: /tmp/model-ids.json
 */
import { readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = resolve('packages/model-bank/src/aiModels');
const out = process.argv[2] || '/tmp/model-ids.json';

const ids = new Set<string>();
for (const f of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
  const mod = await import(join(dir, f));
  for (const m of mod.default || []) {
    if (!m?.id || m.type !== 'chat') continue;
    ids.add(m.id.split('/').pop()!.toLowerCase());
  }
}
writeFileSync(out, JSON.stringify([...ids].sort(), null, 1));
console.log(`${ids.size} unique normalized chat ids -> ${out}`);
