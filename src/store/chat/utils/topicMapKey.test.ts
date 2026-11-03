import { describe, expect, it } from 'vitest';

import { topicMapKey } from './topicMapKey';

describe('topicMapKey', () => {
  describe('auto-detection', () => {
    it('should generate agent key when only agentId is provided', () => {
      const result = topicMapKey({ agentId: 'agent-123' });
      expect(result).toBe('agent_agent-123');
    });

    it('should generate group key when only groupId is provided', () => {
      const result = topicMapKey({ groupId: 'group-456' });
      expect(result).toBe('group_group-456');
    });

    it('should generate group_agent key when both groupId and agentId are provided', () => {
      const result = topicMapKey({ agentId: 'agent-123', groupId: 'group-456' });
      expect(result).toBe('group_agent_group-456_agent-123');
    });
  });

  describe('explicit scope override', () => {
    it('should use explicit agent scope even when groupId is provided', () => {
      const result = topicMapKey({
        agentId: 'agent-123',
        groupId: 'group-456',
        scope: 'agent',
      });
      expect(result).toBe('agent_agent-123');
    });

    it('should use explicit group scope even when agentId is provided', () => {
      const result = topicMapKey({
        agentId: 'agent-123',
        groupId: 'group-456',
        scope: 'group',
      });
      expect(result).toBe('group_group-456');
    });

    it('should use explicit group_agent scope', () => {
      const result = topicMapKey({
        agentId: 'agent-123',
        groupId: 'group-456',
        scope: 'group_agent',
      });
      expect(result).toBe('group_agent_group-456_agent-123');
    });
  });

  describe('edge cases', () => {
    it('should handle undefined agentId with agent scope', () => {
      const result = topicMapKey({ agentId: undefined });
      expect(result).toBe('agent_undefined');
    });

    it('should handle undefined groupId with group scope', () => {
      const result = topicMapKey({ groupId: undefined, scope: 'group' });
      expect(result).toBe('group_undefined');
    });

    it('should handle empty string agentId', () => {
      const result = topicMapKey({ agentId: '' });
      expect(result).toBe('agent_');
    });

    it('should handle empty string groupId', () => {
      const result = topicMapKey({ groupId: '' });
      // Empty string is falsy, so it falls back to agent scope
      expect(result).toBe('agent_undefined');
    });

    it('should handle empty object input', () => {
      const result = topicMapKey({});
      expect(result).toBe('agent_undefined');
    });
  });

  describe('key format consistency', () => {
    it('should produce consistent keys for same input', () => {
      const input = { agentId: 'test-agent', groupId: 'test-group' };
      const result1 = topicMapKey(input);
      const result2 = topicMapKey(input);
      expect(result1).toBe(result2);
    });

    it('should produce different keys for different scopes', () => {
      const agentKey = topicMapKey({ agentId: 'test' });
      const groupKey = topicMapKey({ groupId: 'test' });
      const groupAgentKey = topicMapKey({ agentId: 'test', groupId: 'test' });

      expect(agentKey).not.toBe(groupKey);
      expect(agentKey).not.toBe(groupAgentKey);
      expect(groupKey).not.toBe(groupAgentKey);
    });
  });
});
