// Fixture: runtime-sized fan-out already capped with pMap.
import pMap from 'p-map';

import { enrichTopic } from './enrich';
import { topicModel } from './model';

export const listEnrichedTopics = async (userId: string) => {
  const rows = await topicModel.findByUser(userId);
  return pMap(rows, (row) => enrichTopic(row), { concurrency: 8 });
};
