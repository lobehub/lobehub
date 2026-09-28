// Fixture: fixed tuples stay on Promise.all, including inside a loop.
import { agentModel, topicModel } from './model';

export const loadPair = async (agentId: string, topicId: string) => {
  const [agent, topic] = await Promise.all([
    agentModel.findById(agentId),
    topicModel.findById(topicId),
  ]);
  return { agent, topic };
};

export const loadEach = async (ids: string[]) => {
  const out = [];
  for (const id of ids) {
    const [meta, stats] = await Promise.all([agentModel.findMeta(id), agentModel.findStats(id)]);
    out.push({ meta, stats });
  }
  return out;
};
