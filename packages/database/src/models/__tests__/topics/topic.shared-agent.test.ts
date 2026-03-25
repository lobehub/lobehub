import { describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { TopicModel } from '../../topic';

describe('TopicModel - Shared Agent Support', () => {
  it('should handle shared agent ID by storing it in metadata', async () => {
    const { testClientDB: db, testUserId: userId } = await getTestDB();
    const topicModel = new TopicModel(db, userId);

    // Create a topic with a shared agent ID
    const topic = await topicModel.create({
      agentId: 'shared_8de5545d-f04e-4804-8bc2-4759ee1f945b',
      title: 'Test Topic with Shared Agent',
    });

    // Verify that agentId is null (to avoid FK constraint)
    expect(topic.agentId).toBeNull();

    // Verify that the shared agent ID is stored in metadata
    expect(topic.metadata).toBeDefined();
    expect(topic.metadata?.sharedAgentId).toBe('shared_8de5545d-f04e-4804-8bc2-4759ee1f945b');
  });

  it('should handle regular agent ID normally', async () => {
    const { testClientDB: db, testUserId: userId } = await getTestDB();
    const topicModel = new TopicModel(db, userId);

    // Create a topic with a regular agent ID (will fail FK constraint in real DB, but that's expected)
    const topic = await topicModel.create({
      agentId: 'agent_regular_id',
      title: 'Test Topic with Regular Agent',
    });

    // Verify that agentId is preserved
    expect(topic.agentId).toBe('agent_regular_id');

    // Verify that metadata doesn't have sharedAgentId
    expect(topic.metadata?.sharedAgentId).toBeUndefined();
  });

  it('should handle null agent ID', async () => {
    const { testClientDB: db, testUserId: userId } = await getTestDB();
    const topicModel = new TopicModel(db, userId);

    const topic = await topicModel.create({
      agentId: null,
      title: 'Test Topic without Agent',
    });

    expect(topic.agentId).toBeNull();
    expect(topic.metadata?.sharedAgentId).toBeUndefined();
  });

  it('should query and count topics by shared agent ID from metadata.sharedAgentId', async () => {
    const { testClientDB: db, testUserId: userId } = await getTestDB();
    const topicModel = new TopicModel(db, userId);
    const sharedAgentId = 'shared_topic_query_test';

    const created = await topicModel.create({
      agentId: sharedAgentId,
      title: 'Shared Agent Query Topic',
    });

    const queried = await topicModel.query({ agentId: sharedAgentId });
    const total = await topicModel.count({ agentId: sharedAgentId });

    expect(queried.items).toHaveLength(1);
    expect(queried.items[0]?.id).toBe(created.id);
    expect(queried.items[0]?.title).toBe('Shared Agent Query Topic');
    expect(total).toBe(1);
  });
});
