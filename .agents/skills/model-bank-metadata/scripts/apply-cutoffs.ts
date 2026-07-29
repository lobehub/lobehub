/**
 * One-off codemod: apply a canonical { normalizedModelId: 'YYYY-MM' } map onto
 * packages/model-bank/src/aiModels/*.ts, inserting `knowledgeCutoff` after the
 * `id:` line of every chat-model entry that matches and doesn't already have one.
 *
 * Relies on the uniform prettier formatting of these files:
 *   - each model entry starts with `  {` and ends with `  },` (2-space indent)
 *   - fields are at 4-space indent: `    id: '...'`, `    type: 'chat'`
 *
 * Usage: bun /tmp/apply-cutoffs.ts /tmp/cutoff-map.json
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const mapPath = process.argv[2];
if (!mapPath) throw new Error('usage: bun apply-cutoffs.ts <map.json>');
const map: Record<string, string> = JSON.parse(readFileSync(mapPath, 'utf8'));

const dir = 'packages/model-bank/src/aiModels';
const normalize = (id: string) => id.split('/').pop()!.toLowerCase();

let touchedFiles = 0;
let inserted = 0;
const matchedIds = new Set<string>();

for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
  const path = join(dir, file);
  const lines = readFileSync(path, 'utf8').split('\n');
  const out: string[] = [];
  let changed = false;

  let i = 0;
  while (i < lines.length) {
    if (lines[i] !== '  {') {
      out.push(lines[i]);
      i++;
      continue;
    }
    // collect one model entry block
    const start = i;
    let end = i;
    while (end < lines.length && lines[end] !== '  },') end++;
    const block = lines.slice(start, end + 1);

    const idLineIdx = block.findIndex((l) => /^ {4}id: '/.test(l));
    const isChat = block.some((l) => /^ {4}type: 'chat',?$/.test(l));
    const hasCutoff = block.some((l) => /^ {4}knowledgeCutoff:/.test(l));

    if (idLineIdx >= 0 && isChat && !hasCutoff) {
      const rawId = block[idLineIdx].match(/^ {4}id: '(.+)',$/)?.[1];
      const norm = rawId ? normalize(rawId) : undefined;
      const cutoff = norm ? map[norm] : undefined;
      if (cutoff && /^\d{4}(?:-\d{2})?$/.test(cutoff)) {
        block.splice(idLineIdx + 1, 0, `    knowledgeCutoff: '${cutoff}',`);
        inserted++;
        changed = true;
        matchedIds.add(norm!);
      }
    }
    out.push(...block);
    i = end + 1;
  }

  if (changed) {
    writeFileSync(path, out.join('\n'));
    touchedFiles++;
  }
}

console.log(`inserted ${inserted} knowledgeCutoff fields across ${touchedFiles} files`);
console.log(`map ids used: ${matchedIds.size}/${Object.keys(map).length}`);
const unused = Object.keys(map).filter((k) => !matchedIds.has(k));
if (unused.length) console.log('unused map keys (first 20):', unused.slice(0, 20));
