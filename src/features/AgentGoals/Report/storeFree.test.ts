import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');
const shareGoalDir = path.join(repoRoot, 'apps/share/src/features/goal');
const srcRoot = path.join(repoRoot, 'src');

const EXTENSIONS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

const resolveModule = (from: string, specifier: string): string | undefined => {
  const base = specifier.startsWith('@/')
    ? path.join(srcRoot, specifier.slice(2))
    : specifier.startsWith('.')
      ? path.resolve(path.dirname(from), specifier)
      : undefined;
  if (!base) return undefined;

  return EXTENSIONS.map((ext) => base + ext).find(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
  );
};

// Runtime imports only: `import type` is erased and ships nothing. Dynamic
// imports count — a gated chunk is still part of the share app's graph.
const IMPORT_RE =
  /(?:^|\n)\s*(?:import|export)\s(?!type\s)[^'"`;]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

const closureOf = (entries: string[]) => {
  const seen = new Set<string>();
  const queue = entries.map((entry) => path.join(shareGoalDir, entry));
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(IMPORT_RE)) {
      const resolved = resolveModule(file, (match[1] ?? match[2] ?? match[3])!);
      if (resolved) queue.push(resolved);
    }
  }
  return [...seen].map((file) => path.relative(repoRoot, file));
};

describe('the shared goal page graph', () => {
  const closure = closureOf(['SharedGoalView.tsx', 'SharedGoalGraph.client.tsx']);

  it('walks the whole report, map and acceptance surface', () => {
    expect(closure).toEqual(
      expect.arrayContaining([
        'src/features/AgentGoals/ProcessControl/Graph/ExplorationGraph.tsx',
        'src/features/AgentGoals/Report/ReportChapters.tsx',
        'src/features/AgentGoals/Report/AcceptanceChecks.tsx',
      ]),
    );
  });

  it.each([
    ['the chat store', /src\/store\/chat\//],
    ['the goal store', /src\/store\/goal\//],
    ['the agent store', /src\/store\/agent(Group)?\//],
    ['the Portal', /src\/features\/Portal\//],
    ['entity links', /src\/features\/EntityLink\//],
    ['the portal-hosted map', /Graph\/index\.tsx$/],
  ])('never imports %s', (_name, pattern) => {
    expect(closure.filter((file) => pattern.test(file))).toEqual([]);
  });
});
