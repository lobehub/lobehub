import {
  DEFAULT_MAX_STEPS,
  DEFAULT_TIMEOUT_MINUTES,
  getBenchmarkMeta,
  getCaseTitle,
  type LobeBenchContender,
  nativeCaseId,
} from '@/features/LobeBench/lobeBench';
import { agentEvalService } from '@/services/agentEval';

interface SingleCaseRunParams {
  benchmark?: { metadata?: Record<string, unknown> | null } | null;
  contender: LobeBenchContender;
  datasetId: string;
  testCase: { id: string; metadata?: Record<string, unknown> | null; content?: any };
}

/**
 * Runs one case once with one contender: a run narrowed to that case, started
 * right away. Returns the run id so the caller can open the attempt page.
 */
export const startSingleCaseRun = async ({
  benchmark,
  contender,
  datasetId,
  testCase,
}: SingleCaseRunParams): Promise<string> => {
  const defaults = getBenchmarkMeta(benchmark).defaults;
  const run = (await agentEvalService.createRun({
    config: {
      caseSelection: { caseIds: [nativeCaseId(testCase)], mode: 'include' },
      ...(contender.chatConfig && { chatConfig: contender.chatConfig }),
      k: 1,
      maxSteps: defaults?.maxSteps ?? DEFAULT_MAX_STEPS,
      model: contender.model,
      ...(contender.params && { params: contender.params }),
      provider: contender.provider,
      timeout: (defaults?.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES) * 60_000,
    },
    datasetId,
    name: `${contender.name} · ${getCaseTitle(testCase)}`,
  })) as { id?: string; data?: { id?: string } };
  const runId = run?.id ?? run?.data?.id;
  if (!runId) throw new Error('Run was not created');
  await agentEvalService.startRun(runId);
  return runId;
};
