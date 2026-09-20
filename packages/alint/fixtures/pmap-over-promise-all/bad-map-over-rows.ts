// Fixture: fan-out over a query result with Promise.all.
import { enrichTopic } from './enrich';
import { topicModel } from './model';

export const listEnrichedTopics = async (userId: string) => {
  const rows = await topicModel.findByUser(userId);

  // alint-expect
  return Promise.all(rows.map(async (row) => enrichTopic(row)));
};
