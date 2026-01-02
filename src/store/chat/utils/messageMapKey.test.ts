import { describe, expect, it } from 'vitest';

import { messageMapKey } from './messageMapKey';

describe('messageMapKey', () => {
  describe('Main mode (default scope)', () => {
    it('should use main as default scope when no threadId', () => {
      const result = messageMapKey({ agentId: 'agt_xxx' });
      expect(result).toBe('main_agt_xxx_new');
    });

    it('should generate key for existing topic', () => {
      const result = messageMapKey({ agentId: 'agt_xxx', topicId: 'tpc_yyy' });
      expect(result).toBe('main_agt_xxx_tpc_yyy');
    });

    it('should handle explicit main scope', () => {
      const result = messageMapKey({ scope: 'main', agentId: 'agt_xxx', topicId: 'tpc_yyy' });
      expect(result).toBe('main_agt_xxx_tpc_yyy');
    });
  });

  describe('Thread mode (auto-detected)', () => {
    it('should auto-detect thread scope when threadId is present', () => {
      const result = messageMapKey({
        agentId: 'agt_xxx',
        topicId: 'tpc_yyy',
        threadId: 'thd_zzz',
      });
      expect(result).toBe('thread_agt_xxx_tpc_yyy_thd_zzz');
    });

    it('should generate new thread key with scope and isNew', () => {
      const result = messageMapKey({
        scope: 'thread',
        agentId: 'agt_xxx',
        topicId: 'tpc_yyy',
        isNew: true,
      });
      expect(result).toBe('thread_agt_xxx_tpc_yyy_new');
    });

    it('should handle explicit thread scope with isNew', () => {
      const result = messageMapKey({
        scope: 'thread',
        agentId: 'agt_xxx',
        topicId: 'tpc_yyy',
        isNew: true,
      });
      expect(result).toBe('thread_agt_xxx_tpc_yyy_new');
    });
  });

  describe('Group mode', () => {
    it('should generate key for new group topic', () => {
      const result = messageMapKey({ scope: 'group', agentId: 'grp_xxx' });
      expect(result).toBe('group_grp_xxx_new');
    });

    it('should generate key for existing group topic', () => {
      const result = messageMapKey({ scope: 'group', agentId: 'grp_xxx', topicId: 'tpc_yyy' });
      expect(result).toBe('group_grp_xxx_tpc_yyy');
    });
  });

  describe('Group mode with groupId (auto-detected)', () => {
    it('should auto-detect group scope when groupId is present', () => {
      const result = messageMapKey({
        agentId: 'agt_xxx',
        groupId: 'grp_yyy',
      });
      expect(result).toBe('group_grp_yyy_new');
    });

    it('should use groupId as scopeId for group conversations', () => {
      const result = messageMapKey({
        agentId: 'agt_xxx',
        groupId: 'grp_yyy',
        topicId: 'tpc_zzz',
      });
      expect(result).toBe('group_grp_yyy_tpc_zzz');
    });

    it('should prioritize groupId over agentId for scope detection', () => {
      const result = messageMapKey({
        agentId: 'agt_xxx',
        groupId: 'grp_yyy',
        topicId: 'tpc_zzz',
      });
      // groupId takes priority, agentId is ignored
      expect(result).toContain('grp_yyy');
      expect(result).not.toContain('agt_xxx');
    });

    it('should handle groupId with isNew flag', () => {
      const result = messageMapKey({
        agentId: 'agt_xxx',
        groupId: 'grp_yyy',
        isNew: true,
      });
      expect(result).toBe('group_grp_yyy_new');
    });

    it('should use explicit scope when provided with groupId', () => {
      const result = messageMapKey({
        scope: 'group_agent',
        agentId: 'agt_xxx',
        groupId: 'grp_yyy',
        topicId: 'tpc_zzz',
      });
      // When scope is explicitly set, use that scope but groupId as scopeId
      expect(result).toBe('group_agent_grp_yyy_tpc_zzz');
    });

    it('should generate different keys for same agent in different groups', () => {
      const key1 = messageMapKey({
        agentId: 'agt_xxx',
        groupId: 'grp_111',
        topicId: 'tpc_yyy',
      });
      const key2 = messageMapKey({
        agentId: 'agt_xxx',
        groupId: 'grp_222',
        topicId: 'tpc_yyy',
      });
      expect(key1).not.toBe(key2);
    });
  });

  describe('Group agent mode', () => {
    it('should generate key for new agent topic in group', () => {
      const result = messageMapKey({
        scope: 'group_agent',
        agentId: 'grp_xxx',
        topicId: 'tpc_yyy',
        isNew: true,
      });
      expect(result).toBe('group_agent_grp_xxx_tpc_yyy_new');
    });

    it('should generate key for existing agent topic in group', () => {
      const result = messageMapKey({
        scope: 'group_agent',
        agentId: 'grp_xxx',
        topicId: 'tpc_yyy',
        threadId: 'tpc_zzz', // subTopicId via threadId
      });
      expect(result).toBe('group_agent_grp_xxx_tpc_yyy_tpc_zzz');
    });

    it('should use subAgentId as subTopicId in group_agent scope with groupId', () => {
      const result = messageMapKey({
        scope: 'group_agent',
        agentId: 'agt_supervisor',
        groupId: 'grp_xxx',
        topicId: 'tpc_yyy',
        subAgentId: 'agt_worker',
      });
      expect(result).toBe('group_agent_grp_xxx_tpc_yyy_agt_worker');
    });

    it('should generate new key for group_agent scope with subAgentId and isNew', () => {
      const result = messageMapKey({
        scope: 'group_agent',
        agentId: 'agt_supervisor',
        groupId: 'grp_xxx',
        topicId: 'tpc_yyy',
        subAgentId: 'agt_worker',
        isNew: true,
      });
      // When subAgentId is present, it becomes the subTopicId
      expect(result).toBe('group_agent_grp_xxx_tpc_yyy_agt_worker');
    });

    it('should generate different keys for different subAgentIds', () => {
      const key1 = messageMapKey({
        scope: 'group_agent',
        agentId: 'agt_supervisor',
        groupId: 'grp_xxx',
        topicId: 'tpc_yyy',
        subAgentId: 'agt_worker1',
      });
      const key2 = messageMapKey({
        scope: 'group_agent',
        agentId: 'agt_supervisor',
        groupId: 'grp_xxx',
        topicId: 'tpc_yyy',
        subAgentId: 'agt_worker2',
      });
      expect(key1).not.toBe(key2);
      expect(key1).toBe('group_agent_grp_xxx_tpc_yyy_agt_worker1');
      expect(key2).toBe('group_agent_grp_xxx_tpc_yyy_agt_worker2');
    });

    it('should fallback to group scope when group_agent but no subAgentId', () => {
      // This case might occur when subAgentId is not provided but scope is explicitly set
      // It should fallback to regular group behavior
      const result = messageMapKey({
        scope: 'group_agent',
        agentId: 'agt_supervisor',
        groupId: 'grp_xxx',
        topicId: 'tpc_yyy',
      });
      // Without subAgentId, group_agent falls back to regular group key format
      expect(result).toBe('group_agent_grp_xxx_tpc_yyy');
    });
  });

  describe('Key uniqueness and isolation', () => {
    it('should generate different keys for different scopes', () => {
      const mainKey = messageMapKey({ agentId: 'agt_xxx', topicId: 'tpc_yyy' });
      const threadKey = messageMapKey({
        agentId: 'agt_xxx',
        topicId: 'tpc_yyy',
        threadId: 'thd_zzz',
      });
      const groupKey = messageMapKey({ scope: 'group', agentId: 'grp_xxx', topicId: 'tpc_yyy' });
      const groupAgentKey = messageMapKey({
        scope: 'group_agent',
        agentId: 'grp_xxx',
        topicId: 'tpc_yyy',
        threadId: 'tpc_zzz',
      });

      expect(new Set([mainKey, threadKey, groupKey, groupAgentKey]).size).toBe(4);
    });

    it('should generate different keys for different agentIds', () => {
      const key1 = messageMapKey({ agentId: 'agt_111', topicId: 'tpc_yyy' });
      const key2 = messageMapKey({ agentId: 'agt_222', topicId: 'tpc_yyy' });
      expect(key1).not.toBe(key2);
    });

    it('should generate different keys for different topicIds', () => {
      const key1 = messageMapKey({ agentId: 'agt_xxx', topicId: 'tpc_111' });
      const key2 = messageMapKey({ agentId: 'agt_xxx', topicId: 'tpc_222' });
      expect(key1).not.toBe(key2);
    });

    it('should generate different keys for different threadIds', () => {
      const key1 = messageMapKey({
        agentId: 'agt_xxx',
        topicId: 'tpc_yyy',
        threadId: 'thd_111',
      });
      const key2 = messageMapKey({
        agentId: 'agt_xxx',
        topicId: 'tpc_yyy',
        threadId: 'thd_222',
      });
      expect(key1).not.toBe(key2);
    });

    it('should isolate new threads from different topics', () => {
      const newThread1 = messageMapKey({
        scope: 'thread',
        agentId: 'agt_xxx',
        topicId: 'tpc_111',
        isNew: true,
      });
      const newThread2 = messageMapKey({
        scope: 'thread',
        agentId: 'agt_xxx',
        topicId: 'tpc_222',
        isNew: true,
      });
      expect(newThread1).not.toBe(newThread2);
      expect(newThread1).toBe('thread_agt_xxx_tpc_111_new');
      expect(newThread2).toBe('thread_agt_xxx_tpc_222_new');
    });
  });

  describe('Edge cases', () => {
    it('should handle null topicId as no topic (new)', () => {
      const result = messageMapKey({ agentId: 'agt_xxx', topicId: null });
      expect(result).toBe('main_agt_xxx_new');
    });

    it('should handle undefined topicId as no topic (new)', () => {
      const result = messageMapKey({ agentId: 'agt_xxx', topicId: undefined });
      expect(result).toBe('main_agt_xxx_new');
    });

    it('should handle null threadId (no thread, fallback to main)', () => {
      const result = messageMapKey({
        agentId: 'agt_xxx',
        topicId: 'tpc_yyy',
        threadId: null,
      });
      expect(result).toBe('main_agt_xxx_tpc_yyy');
    });

    it('should be consistent when called multiple times', () => {
      const context = {
        agentId: 'agt_xxx',
        topicId: 'tpc_yyy',
        threadId: 'thd_zzz',
      };
      expect(messageMapKey(context)).toBe(messageMapKey(context));
    });

    it('should handle special characters in IDs', () => {
      const result = messageMapKey({
        agentId: 'agt_123-abc_def',
        topicId: 'tpc_456-xyz',
      });
      expect(result).toBe('main_agt_123-abc_def_tpc_456-xyz');
    });
  });

  describe('isNew flag behavior', () => {
    it('should add _new suffix when isNew is true and topicId exists', () => {
      const result = messageMapKey({
        scope: 'thread',
        agentId: 'agt_xxx',
        topicId: 'tpc_yyy',
        isNew: true,
      });
      expect(result).toBe('thread_agt_xxx_tpc_yyy_new');
    });

    it('should not add extra _new when isNew is true but no topicId (already _new)', () => {
      const result = messageMapKey({
        scope: 'main',
        agentId: 'agt_xxx',
        isNew: true,
      });
      expect(result).toBe('main_agt_xxx_new');
    });

    it('should ignore isNew when threadId exists', () => {
      const result = messageMapKey({
        agentId: 'agt_xxx',
        topicId: 'tpc_yyy',
        threadId: 'thd_zzz',
        isNew: true,
      });
      // threadId takes priority, isNew is ignored
      expect(result).toBe('thread_agt_xxx_tpc_yyy_thd_zzz');
    });
  });

  describe('Real-world scenarios', () => {
    it('Scenario: User starts new conversation in agent', () => {
      const result = messageMapKey({ agentId: 'agt_abc123' });
      expect(result).toBe('main_agt_abc123_new');
    });

    it('Scenario: User continues conversation in existing topic', () => {
      const result = messageMapKey({
        agentId: 'agt_abc123',
        topicId: 'tpc_xyz789',
      });
      expect(result).toBe('main_agt_abc123_tpc_xyz789');
    });

    it('Scenario: User creates a new thread from a message', () => {
      const result = messageMapKey({
        scope: 'thread',
        agentId: 'agt_abc123',
        topicId: 'tpc_xyz789',
        isNew: true,
      });
      expect(result).toBe('thread_agt_abc123_tpc_xyz789_new');
    });

    it('Scenario: User enters an existing thread', () => {
      const result = messageMapKey({
        agentId: 'agt_abc123',
        topicId: 'tpc_xyz789',
        threadId: 'thd_thread001',
      });
      expect(result).toBe('thread_agt_abc123_tpc_xyz789_thd_thread001');
    });

    it('Scenario: User chats in a group', () => {
      const result = messageMapKey({
        scope: 'group',
        agentId: 'grp_group001',
        topicId: 'tpc_grouptopic',
      });
      expect(result).toBe('group_grp_group001_tpc_grouptopic');
    });

    it('Scenario: User chats with specific agent in group', () => {
      const result = messageMapKey({
        scope: 'group_agent',
        agentId: 'grp_group001',
        topicId: 'tpc_grouptopic',
        threadId: 'tpc_agenttopic',
      });
      expect(result).toBe('group_agent_grp_group001_tpc_grouptopic_tpc_agenttopic');
    });

    it('Scenario: User sends message to group using groupId parameter', () => {
      // This is the new pattern used in sendGroupMessage
      const result = messageMapKey({
        agentId: 'agt_agent001',
        groupId: 'grp_group001',
        topicId: 'tpc_grouptopic',
      });
      expect(result).toBe('group_grp_group001_tpc_grouptopic');
    });

    it('Scenario: User starts new conversation in group using groupId parameter', () => {
      const result = messageMapKey({
        agentId: 'agt_agent001',
        groupId: 'grp_group001',
      });
      expect(result).toBe('group_grp_group001_new');
    });

    it('Scenario: Agent executes in group orchestration with subAgentId', () => {
      // In group orchestration, supervisor calls speak/broadcast
      // The executing agent should store messages under group's main key
      // but use subAgentId to identify agent config and message.agentId
      const result = messageMapKey({
        agentId: 'agt_supervisor',
        groupId: 'grp_group001',
        topicId: 'tpc_grouptopic',
        scope: 'group', // Messages still go to main group conversation
      });
      expect(result).toBe('group_grp_group001_tpc_grouptopic');
    });

    it('Scenario: Agent has independent message stream in group (group_agent scope)', () => {
      // When an agent needs its own message stream (future execTask scenario)
      const result = messageMapKey({
        agentId: 'agt_supervisor',
        groupId: 'grp_group001',
        topicId: 'tpc_grouptopic',
        subAgentId: 'agt_worker',
        scope: 'group_agent',
      });
      expect(result).toBe('group_agent_grp_group001_tpc_grouptopic_agt_worker');
    });
  });
});
