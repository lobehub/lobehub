import type { AgentEvalDatasetListItem, AgentEvalRunTopicResult } from '@lobechat/types';

import { agentEvalService } from '@/services/agentEval';
import { isLobeBenchKind } from '@/store/eval/kinds';

import type { CasesByDataset, LobeBenchCase, RunResultsByRun } from './projection';

const byNewest = (a: { createdAt?: unknown }, b: { createdAt?: unknown }) =>
  new Date((b.createdAt as string | number | Date | undefined) ?? 0).getTime() -
  new Date((a.createdAt as string | number | Date | undefined) ?? 0).getTime();

const listOf = <T>(response: unknown): T[] => {
  if (Array.isArray(response)) return response as T[];
  const data = (response as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? (data as T[]) : [];
};

/** Datasets of the given benchmarks, plus the imported ones that belong to none. */
export const fetchLobeBenchDatasets = async (benchmarkIds: string[]) => {
  const [lists, all] = await Promise.all([
    Promise.all(benchmarkIds.map((id) => agentEvalService.listDatasets(id))),
    agentEvalService.listAllDatasets(),
  ]);
  // An imported dataset belongs to no benchmark until one is made of it.
  const standalone = listOf<AgentEvalDatasetListItem>(all).filter(
    (dataset) => !dataset.benchmarkId && isLobeBenchKind(dataset),
  );
  return [...lists.flatMap((list) => listOf<AgentEvalDatasetListItem>(list)), ...standalone].sort(
    byNewest,
  );
};

/** Every run under the given benchmarks, newest first. */
export const fetchLobeBenchRuns = async (benchmarkIds: string[]) => {
  const lists = await Promise.all(
    benchmarkIds.map((benchmarkId) => agentEvalService.listAllRuns({ benchmarkId })),
  );
  return lists.flat().sort(byNewest);
};

/** Per-case results of several runs, keyed by run id. */
export const fetchRunResultsByRun = async (runIds: string[]): Promise<RunResultsByRun> => {
  const entries = await Promise.all(
    runIds.map(async (runId) => {
      const response = (await agentEvalService.getRunResults(runId)) as {
        data?: { results?: AgentEvalRunTopicResult[] };
        results?: AgentEvalRunTopicResult[];
      };
      return [runId, response?.results ?? response?.data?.results ?? []] as const;
    }),
  );
  return Object.fromEntries(entries);
};

const CASE_PAGE = 100;

/** All cases of a dataset, in benchmark order. */
export const fetchDatasetCases = async (datasetId: string) => {
  const cases: LobeBenchCase[] = [];
  for (let offset = 0; ; offset += CASE_PAGE) {
    const response = (await agentEvalService.listTestCases({
      datasetId,
      limit: CASE_PAGE,
      offset,
    })) as { data?: LobeBenchCase[]; total?: number };
    const page = response?.data ?? [];
    cases.push(...page);
    if (page.length < CASE_PAGE || cases.length >= (response?.total ?? cases.length)) break;
  }
  return cases;
};

/** All cases of several datasets, keyed by dataset id. */
export const fetchCasesByDataset = async (datasetIds: string[]): Promise<CasesByDataset> => {
  const result: CasesByDataset = {};
  // One dataset at a time: a library view may hold several large case sets.
  for (const datasetId of datasetIds) result[datasetId] = await fetchDatasetCases(datasetId);
  return result;
};
