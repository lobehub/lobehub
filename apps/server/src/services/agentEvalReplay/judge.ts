import type { MatchContext } from '@lobechat/eval-rubric';
import type { UserSystemAgentConfig } from '@lobechat/types';
import debug from 'debug';

import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

import { resolveSystemAgentModelConfig } from '../systemAgent/modelConfig';

const log = debug('lobe-server:agent-eval-judge');

export interface EvalJudgeModel {
  model: string;
  provider: string;
}

/**
 * Resolve the judge model: an explicit run-level choice wins, otherwise the
 * user's system-agent "topic" model, otherwise the product default — the same
 * chain task review uses, so an eval without a configured judge still scores.
 */
export const resolveEvalJudgeModel = async (
  db: LobeChatDatabase,
  userId: string,
  override?: { model?: string; provider?: string },
): Promise<EvalJudgeModel> => {
  if (override?.model && override?.provider) {
    return resolveSystemAgentModelConfig({ override, taskKey: 'topic' });
  }

  const settings = await new UserModel(db, userId).getUserSettings();
  const systemAgent = settings?.systemAgent as Partial<UserSystemAgentConfig> | undefined;

  return resolveSystemAgentModelConfig({
    override,
    taskConfig: systemAgent?.topic,
    taskKey: 'topic',
  });
};

/**
 * `eval-rubric` match context backed by the server-side model runtime. Without
 * one, every `llm-rubric` case scores 0 with "LLM judge not available".
 *
 * The judge sees only what `matchLLMRubric` puts in its prompt — criteria,
 * input, output, expected — never the conversation the case came from, so the
 * criteria stored on a case has to carry every background fact it relies on.
 */
export const createEvalJudgeContext = async (params: {
  db: LobeChatDatabase;
  judge: EvalJudgeModel;
  trigger: string;
  userId: string;
  workspaceId?: string;
}): Promise<MatchContext> => {
  const { db, judge, trigger, userId, workspaceId } = params;
  const runtime = await initModelRuntimeFromDB(db, userId, judge.provider, workspaceId);

  return {
    generateObject: async (payload) => {
      // The full judge prompt — what "self-contained criteria" has to survive on.
      log('judge %s/%s prompt: %O', judge.provider, judge.model, payload.messages);
      return runtime.generateObject(
        {
          messages: payload.messages as any[],
          model: payload.model || judge.model,
          schema: { name: 'judge_score', schema: payload.schema as any },
        },
        { metadata: { trigger } },
      );
    },
    judgeModel: judge.model,
  };
};
