import type { RubricType } from '@lobechat/types';

import { LOBE_BENCH_KIND } from '@/features/LobeBench/lobeBench';
import { type LobeBenchCase, ownEnvironmentOf } from '@/features/LobeBench/useLobeBench';
import { mutate } from '@/libs/swr';
import { agentEvalService } from '@/services/agentEval';

/**
 * Revalidates every cached Lobe Bench dataset list (sidebar, pickers, pages).
 * Goes through the scoped mutate: the app's SWR cache provider makes the
 * global one from `swr` a no-op.
 */
export const refreshLobeBenchDatasets = () =>
  mutate((key) => Array.isArray(key) && key[0] === 'lobe-bench/datasets');

interface LibraryDataset {
  evalConfig?: unknown;
  evalMode?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * The row a library case is copied into a dataset as: its own content (the
 * shared environment stays referenced, not merged in), rules, judge and ids.
 * The copy is marked as coming from the library; a dataset's cases are fixed
 * once it is made.
 */
const copyOf = (item: LobeBenchCase) => {
  const overrides = ownEnvironmentOf(item);
  const { environment: _merged, ...content } = (item.content ?? {}) as Record<string, unknown>;
  return {
    content: {
      ...content,
      ...(overrides && Object.keys(overrides).length > 0 && { environment: overrides }),
    } as { input: string },
    environmentId: item.environmentId ?? null,
    ...(item.evalConfig && { evalConfig: item.evalConfig }),
    ...(item.evalMode && { evalMode: item.evalMode as RubricType }),
    metadata: { ...item.metadata, source: 'library' },
    sortOrder: item.sortOrder ?? undefined,
  };
};

/**
 * A new account dataset that holds copies of these library cases, as an
 * Evaluation Lab dataset holds its cases. It takes the
 * library's mock, judge and case version, so it runs in any benchmark. Its
 * cases are fixed from then on, so the runs on it stay true to it.
 */
export const createDataset = async (
  benchmarkId: string,
  name: string,
  library: LibraryDataset | undefined,
  cases: LobeBenchCase[],
): Promise<{ id: string }> => {
  const libraryMeta = library?.metadata ?? {};
  const created = (await agentEvalService.createDataset({
    benchmarkId,
    cases: cases.map(copyOf),
    ...(library?.evalConfig ? { evalConfig: library.evalConfig as never } : {}),
    ...(library?.evalMode ? { evalMode: library.evalMode as never } : {}),
    identifier: `dataset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    metadata: {
      custom: true,
      kind: LOBE_BENCH_KIND,
      ...(libraryMeta.mock ? { mock: libraryMeta.mock } : {}),
      ...(libraryMeta.presentation ? { presentation: libraryMeta.presentation } : {}),
      ...(libraryMeta.release ? { release: libraryMeta.release } : {}),
    },
    name,
  })) as { id?: string; data?: { id?: string } };
  const id = created?.id ?? created?.data?.id;
  if (!id) throw new Error('Dataset was not created');
  await refreshLobeBenchDatasets();
  return { id };
};

/** Renames an account dataset. */
export const renameDataset = async (
  dataset: { id: string; metadata?: Record<string, unknown> | null },
  name: string,
) => {
  await agentEvalService.updateDataset({ id: dataset.id, metadata: dataset.metadata ?? {}, name });
  await refreshLobeBenchDatasets();
};

/**
 * Files account datasets under a benchmark: one the account made, or back under
 * the library's benchmark, where they are in no benchmark of the account's.
 */
export const moveDatasets = async (
  datasets: Array<{ id: string; name: string }>,
  benchmarkId: string,
) => {
  for (const dataset of datasets) {
    await agentEvalService.updateDataset({ benchmarkId, id: dataset.id, name: dataset.name });
  }
  await refreshLobeBenchDatasets();
};
