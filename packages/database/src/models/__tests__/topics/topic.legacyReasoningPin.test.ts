// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { TopicModel } from '../../topic';

const userId = 'topic-legacy-pin-user';
const serverDB: LobeChatDatabase = await getTestDB();
const topicModel = new TopicModel(serverDB, userId);

const readPin = async (id: string) => {
  const [row] = await serverDB.select().from(topics).where(eq(topics.id, id));
  return row?.metadata?.reasoningConfig;
};

/** A released client still writes the per-model legacy effort keys. */
const legacy = (config: Record<string, string>) => config as any;

describe('TopicModel legacy reasoning pins from released clients', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values([{ id: userId }]);
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  it("keeps the topic model's own legacy key on create", async () => {
    const topic = await topicModel.create({
      metadata: {
        reasoningConfig: legacy({ gpt5_2ReasoningEffort: 'xhigh', thinkingLevel: 'low' }),
      },
      model: 'gpt-5.2',
      provider: 'openai',
      title: 'pinned',
    });

    expect(await readPin(topic.id)).toEqual({ reasoningEffort: 'xhigh' });
  });

  it('translates a metadata patch with the persisted topic model', async () => {
    const topic = await topicModel.create({ model: 'gpt-5.2', provider: 'openai', title: 't' });

    await topicModel.updateMetadata(topic.id, {
      reasoningConfig: legacy({ gpt5_2ReasoningEffort: 'high', reasoningEffort: 'low' }),
    });

    expect(await readPin(topic.id)).toEqual({ reasoningEffort: 'high' });
  });

  it('translates the pin sent with a model switch', async () => {
    const topic = await topicModel.create({ model: 'gpt-5.2', provider: 'openai', title: 't' });

    await topicModel.updateModelPin(topic.id, {
      metadata: { reasoningConfig: legacy({ gpt5_6ReasoningEffort: 'max' }) },
      model: 'gpt-5.6-sol',
      provider: 'openai',
    });

    expect(await readPin(topic.id)).toEqual({ reasoningEffort: 'max' });
  });
});
