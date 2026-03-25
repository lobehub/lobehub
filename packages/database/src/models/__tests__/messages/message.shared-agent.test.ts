import { describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { MessageModel } from '../../message';

describe('MessageModel - Shared Agent Support', () => {
  it('should handle shared agent ID by storing it in metadata', async () => {
    const { testClientDB: db, testUserId: userId } = await getTestDB();
    const messageModel = new MessageModel(db, userId);

    // Create a message with a shared agent ID
    const message = await messageModel.create({
      agentId: 'shared_8de5545d-f04e-4804-8bc2-4759ee1f945b',
      content: 'Test message with shared agent',
      role: 'user',
    });

    // Verify that agentId is null (to avoid FK constraint)
    expect(message.agentId).toBeNull();

    // Verify that the shared agent ID is stored in metadata
    expect(message.metadata).toBeDefined();
    expect((message.metadata as any)?.sharedAgentId).toBe(
      'shared_8de5545d-f04e-4804-8bc2-4759ee1f945b',
    );
  });

  it('should handle regular agent ID normally', async () => {
    const { testClientDB: db, testUserId: userId } = await getTestDB();
    const messageModel = new MessageModel(db, userId);

    // Create a message with a regular agent ID (will fail FK constraint in real DB, but that's expected)
    const message = await messageModel.create({
      agentId: 'agent_regular_id',
      content: 'Test message with regular agent',
      role: 'user',
    });

    // Verify that agentId is preserved
    expect(message.agentId).toBe('agent_regular_id');

    // Verify that metadata doesn't have sharedAgentId
    expect((message.metadata as any)?.sharedAgentId).toBeUndefined();
  });

  it('should handle null agent ID', async () => {
    const { testClientDB: db, testUserId: userId } = await getTestDB();
    const messageModel = new MessageModel(db, userId);

    const message = await messageModel.create({
      agentId: null,
      content: 'Test message without agent',
      role: 'user',
    });

    expect(message.agentId).toBeNull();
    expect((message.metadata as any)?.sharedAgentId).toBeUndefined();
  });

  it('should handle shared agent ID in batchCreate', async () => {
    const { testClientDB: db, testUserId: userId } = await getTestDB();
    const messageModel = new MessageModel(db, userId);

    // Create messages with shared agent IDs
    await messageModel.batchCreate([
      {
        agentId: 'shared_8de5545d-f04e-4804-8bc2-4759ee1f945b',
        content: 'Test message 1',
        id: 'msg_1',
        role: 'user',
      } as any,
      {
        agentId: 'shared_another-shared-agent',
        content: 'Test message 2',
        id: 'msg_2',
        role: 'user',
      } as any,
    ]);

    // Query the messages to verify
    const messages = await db.query.messages.findMany({
      where: (messages, { inArray }) => inArray(messages.id, ['msg_1', 'msg_2']),
    });

    expect(messages).toHaveLength(2);
    messages.forEach((msg) => {
      expect(msg.agentId).toBeNull();
      expect((msg.metadata as any)?.sharedAgentId).toBeDefined();
      expect((msg.metadata as any)?.sharedAgentId).toMatch(/^shared_/);
    });
  });

  it('should query messages by shared agent ID from metadata.sharedAgentId', async () => {
    const { testClientDB: db, testUserId: userId } = await getTestDB();
    const messageModel = new MessageModel(db, userId);
    const sharedAgentId = 'shared_query_test_agent';

    const created = await messageModel.create({
      agentId: sharedAgentId,
      content: 'query shared agent message',
      role: 'user',
    });

    const queried = await messageModel.query({ agentId: sharedAgentId });

    expect(queried).toHaveLength(1);
    expect(queried[0]?.id).toBe(created.id);
    expect(queried[0]?.content).toBe('query shared agent message');
  });
});
