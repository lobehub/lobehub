import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const map: Record<string, { family: string; generation?: string }> = JSON.parse(
  readFileSync('/tmp/family-map.json', 'utf8'),
);
const dir = 'packages/model-bank/src/aiModels';
const normalize = (id: string) => id.split('/').pop()!.toLowerCase();

let inserted = 0;
let touchedFiles = 0;
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
    let end = i;
    while (end < lines.length && lines[end] !== '  },') end++;
    const block = lines.slice(i, end + 1);
    const idLineIdx = block.findIndex((l) => /^ {4}id: '/.test(l));
    const isChat = block.some((l) => /^ {4}type: 'chat',?$/.test(l));
    const hasFamily = block.some((l) => /^ {4}family:/.test(l));
    if (idLineIdx >= 0 && isChat && !hasFamily) {
      const rawId = block[idLineIdx].match(/^ {4}id: '(.+)',$/)?.[1];
      const r = rawId ? map[normalize(rawId)] : undefined;
      if (r) {
        const add = [`    family: '${r.family}',`];
        if (r.generation) add.push(`    generation: '${r.generation}',`);
        block.splice(idLineIdx, 0, ...add);
        inserted++;
        changed = true;
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
console.log(`annotated ${inserted} model entries across ${touchedFiles} files`);
