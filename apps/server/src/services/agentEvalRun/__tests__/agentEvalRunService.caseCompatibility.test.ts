import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { AgentEvalRunModel, AgentEvalRunTopicModel } from '@/database/models/agentEval';
import { agentEvalDatasets, agentEvalTestCases, messages } from '@/database/schemas';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';
import { EvalCaseCompatibilityError } from '@/server/services/agentEvalRun/caseCompatibility';

import { cleanupDB, serverDB, setupEvalChain, userId } from './_setup';

beforeEach(cleanupDB);

describe.each(['rejudge', 'rerun', 'retryErrors', 'retrySingle'] as const)(
  '%s case compatibility',
  (action) => {
    it.each(['changed version', 'retired case'] as const)(
      'preserves every recorded row when rejecting a %s',
      async (reason) => {
        const chain = await setupEvalChain({
          assistantOutput: '42',
          datasetEvalMode: 'contains',
          totalCases: 1,
        });
        const runModel = new AgentEvalRunModel(serverDB, userId);
        const runTopics = new AgentEvalRunTopicModel(serverDB, userId);
        await runModel.update(chain.run.id, { config: { caseVersion: 'v1' }, status: 'completed' });
        await serverDB
          .update(agentEvalDatasets)
          .set({
            metadata: { release: reason === 'changed version' ? 'v2' : 'v1' },
          })
          .where(eq(agentEvalDatasets.id, chain.dataset.id));
        if (reason === 'retired case') {
          await serverDB
            .update(agentEvalTestCases)
            .set({ metadata: { retired: true } })
            .where(eq(agentEvalTestCases.id, chain.testCase.id));
        }
        await runTopics.updateByRunAndTopic(chain.run.id, chain.topic.id, {
          evalResult: {
            error: action === 'rejudge' ? undefined : 'Provider unavailable',
            externalResult: { evidence: 'Original judgment' },
          },
          passed: action === 'rejudge',
          score: action === 'rejudge' ? 1 : undefined,
          status: action === 'rejudge' ? 'passed' : 'error',
        });
        const originalRun = await runModel.findById(chain.run.id);
        const originalTopics = await runTopics.findByRunId(chain.run.id);
        const originalMessages = await serverDB.select().from(messages);
        const service = new AgentEvalRunService(serverDB, userId);
        const attempt = () => {
          if (action === 'rejudge') return service.rejudgeRun(chain.run.id);
          if (action === 'rerun') return service.rerunUnverifiedCases(chain.run.id);
          if (action === 'retryErrors') return service.retryErrorCases(chain.run.id);
          return service.retrySingleCase(chain.run.id, chain.testCase.id);
        };
        await expect(attempt()).rejects.toThrow(EvalCaseCompatibilityError);
        expect(await runModel.findById(chain.run.id)).toEqual(originalRun);
        expect(await runTopics.findByRunId(chain.run.id)).toEqual(originalTopics);
        expect(await serverDB.select().from(messages)).toEqual(originalMessages);
      },
    );
  },
);
