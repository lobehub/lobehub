import { type AgentGroupDetail } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { type ChatGroupStore } from '../store';
import { agentGroupByIdSelectors } from './byId';

// Helper to create mock AgentGroupDetail with required fields
const createMockGroup = (overrides: Partial<AgentGroupDetail>): AgentGroupDetail => ({
  agents: [],
  createdAt: new Date(),
  id: 'group-1',
  supervisorAgentId: 'supervisor-1',
  title: 'Test Group',
  updatedAt: new Date(),
  userId: 'user-1',
  ...overrides,
});

describe('agentGroupByIdSelectors', () => {
  describe('groupBySupervisorAgentId', () => {
    it('should find group by supervisor agent ID', () => {
      const mockGroup = createMockGroup({
        id: 'group-1',
        supervisorAgentId: 'supervisor-agent-1',
        title: 'Test Group',
        agents: [
          { id: 'supervisor-agent-1', title: 'Supervisor', isSupervisor: true },
          { id: 'agent-1', title: 'Agent 1', isSupervisor: false },
        ] as AgentGroupDetail['agents'],
      });

      const state: Partial<ChatGroupStore> = {
        groupMap: {
          'group-1': mockGroup,
        },
      };

      const result = agentGroupByIdSelectors.groupBySupervisorAgentId('supervisor-agent-1')(
        state as ChatGroupStore,
      );

      expect(result).toEqual(mockGroup);
    });

    it('should return undefined when supervisor agent ID not found', () => {
      const mockGroup = createMockGroup({
        id: 'group-1',
        supervisorAgentId: 'supervisor-agent-1',
        title: 'Test Group',
      });

      const state: Partial<ChatGroupStore> = {
        groupMap: {
          'group-1': mockGroup,
        },
      };

      const result = agentGroupByIdSelectors.groupBySupervisorAgentId('non-existent-supervisor')(
        state as ChatGroupStore,
      );

      expect(result).toBeUndefined();
    });

    it('should return undefined when groupMap is empty', () => {
      const state: Partial<ChatGroupStore> = {
        groupMap: {},
      };

      const result = agentGroupByIdSelectors.groupBySupervisorAgentId('any-supervisor')(
        state as ChatGroupStore,
      );

      expect(result).toBeUndefined();
    });

    it('should find correct group when multiple groups exist', () => {
      const mockGroup1 = createMockGroup({
        id: 'group-1',
        supervisorAgentId: 'supervisor-1',
        title: 'Group 1',
      });

      const mockGroup2 = createMockGroup({
        id: 'group-2',
        supervisorAgentId: 'supervisor-2',
        title: 'Group 2',
      });

      const state: Partial<ChatGroupStore> = {
        groupMap: {
          'group-1': mockGroup1,
          'group-2': mockGroup2,
        },
      };

      const result = agentGroupByIdSelectors.groupBySupervisorAgentId('supervisor-2')(
        state as ChatGroupStore,
      );

      expect(result).toEqual(mockGroup2);
    });
  });
});
