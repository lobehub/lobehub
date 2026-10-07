import type { AgentEvalRunListItem } from '@lobechat/types';

export interface RunModel {
  model: string;
  provider?: string;
}

type RunLike = Pick<AgentEvalRunListItem, 'config' | 'targetAgent'>;

/**
 * The model a run actually evaluated with. A run may override the agent's model
 * (`config.subjectModel`), else it ran on the agent as snapshotted at start,
 * else — for runs that never started — on the agent's current model.
 */
export const getRunModel = (run: RunLike): RunModel | undefined => {
  const config = run.config;
  if (config?.subjectModel) {
    return { model: config.subjectModel, provider: config.subjectProvider ?? undefined };
  }
  const snapshot = config?.agentSnapshot;
  if (snapshot?.model) return { model: snapshot.model, provider: snapshot.provider ?? undefined };
  if (run.targetAgent?.model) {
    return { model: run.targetAgent.model, provider: run.targetAgent.provider };
  }
  return undefined;
};
