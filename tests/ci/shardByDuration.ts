import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { TestSpecification } from 'vitest/node';
import { BaseSequencer } from 'vitest/node';

/**
 * CI shards (`--shard=i/n`) by recorded duration instead of by file count.
 *
 * Vitest's default splits files evenly by count after sorting them by a hash
 * of their path, so one shard routinely lands minutes behind the others. When
 * `VITEST_SHARD_DURATIONS` points at a JSON map of `project:path` → ms (written
 * on canary by `durationReporter.ts`), every shard job computes the same
 * longest-first greedy partition and keeps its own part. Files without a
 * recorded duration weigh the median. Without the map this is the default.
 */
export class DurationShardSequencer extends BaseSequencer {
  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const durations = readDurations(process.env.VITEST_SHARD_DURATIONS);
    const shard = this.ctx.config.shard;
    if (!durations || !shard) return super.shard(files);

    const root = this.ctx.config.root;
    const keyOf = (spec: TestSpecification) => durationKey(spec.project.name, root, spec.moduleId);
    const fallback = median(Object.values(durations));
    const parts = partitionByDuration(
      files,
      shard.count,
      (spec) => durations[keyOf(spec)] ?? fallback,
      keyOf,
    );
    return parts[shard.index - 1] ?? [];
  }
}

export const durationKey = (projectName: string, root: string, moduleId: string) =>
  `${projectName}:${path.relative(root, moduleId).split(path.sep).join('/')}`;

/**
 * Longest-processing-time-first: heaviest item onto the lightest bin. Ties go
 * by key and by lowest bin index, so every shard job derives the same split.
 */
export function partitionByDuration<T>(
  items: T[],
  count: number,
  weightOf: (item: T) => number,
  keyOf: (item: T) => string,
): T[][] {
  const weighted = items
    .map((item) => ({ item, key: keyOf(item), weight: Math.max(0, weightOf(item)) }))
    .sort((a, b) => b.weight - a.weight || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const bins = Array.from({ length: count }, () => ({ items: [] as T[], total: 0 }));
  for (const { item, weight } of weighted) {
    let lightest = bins[0];
    for (const bin of bins) if (bin.total < lightest.total) lightest = bin;
    lightest.items.push(item);
    lightest.total += weight;
  }
  return bins.map((bin) => bin.items);
}

function readDurations(file: string | undefined): Record<string, number> | undefined {
  if (!file || !existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

function median(values: number[]) {
  const sorted = values.filter((value) => value > 0).sort((a, b) => a - b);
  return sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 1;
}
