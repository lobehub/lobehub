import { describe, expect, it } from 'vitest';

import type { AgentState } from '../../types/state';
import type { GroupOrchestrationSupervisorConfig } from '../GroupOrchestrationSupervisor';
import { GroupOrchestrationSupervisor } from '../GroupOrchestrationSupervisor';
import type { ExecutorResult } from '../types';

// Helper to create mock AgentState
const createMockState = (): AgentState => ({
  cost: {
    calculatedAt: new Date().toISOString(),
    currency: 'USD',
    llm: { byModel: [], currency: 'USD', total: 0 },
    tools: { byTool: [], currency: 'USD', total: 0 },
    total: 0,
  },
  createdAt: new Date().toISOString(),
  lastModified: new Date().toISOString(),
  messages: [],
  operationId: 'test-operation',
  status: 'running',
  stepCount: 0,
  toolManifestMap: {},
  usage: {
    humanInteraction: {
      approvalRequests: 0,
      promptRequests: 0,
      selectRequests: 0,
      totalWaitingTimeMs: 0,
    },
    llm: { apiCalls: 0, processingTimeMs: 0, tokens: { input: 0, output: 0, total: 0 } },
    tools: { byTool: [], totalCalls: 0, totalTimeMs: 0 },
  },
});

describe('GroupOrchestrationSupervisor', () => {
  const defaultConfig: GroupOrchestrationSupervisorConfig = {
    maxRounds: 10,
    supervisorAgentId: 'supervisor-agent-1',
  };

  describe('constructor', () => {
    it('should create instance with config', () => {
      const supervisor = new GroupOrchestrationSupervisor(defaultConfig);
      expect(supervisor).toBeInstanceOf(GroupOrchestrationSupervisor);
    });
  });

  describe('decide - init result', () => {
    it('should return call_supervisor instruction on init', async () => {
      const supervisor = new GroupOrchestrationSupervisor(defaultConfig);
      const state = createMockState();

      const result: ExecutorResult = {
        type: 'init',
        payload: { groupId: 'group-1' },
      };

      const instruction = await supervisor.decide(result, state);

      expect(instruction).toEqual({
        type: 'call_supervisor',
        payload: {
          groupId: 'group-1',
          round: 0,
          supervisorAgentId: 'supervisor-agent-1',
        },
      });
    });
  });

  describe('decide - supervisor_decided result', () => {
    it('should return call_agent instruction for speak decision', async () => {
      const supervisor = new GroupOrchestrationSupervisor(defaultConfig);
      const state = createMockState();

      const result: ExecutorResult = {
        type: 'supervisor_decided',
        payload: {
          decision: 'speak',
          params: { agentId: 'agent-1', instruction: 'Please respond' },
          skipCallSupervisor: false,
        },
      };

      const instruction = await supervisor.decide(result, state);

      expect(instruction).toEqual({
        type: 'call_agent',
        payload: {
          agentId: 'agent-1',
          instruction: 'Please respond',
        },
      });
    });

    it('should return parallel_call_agents instruction for broadcast decision with disableTools: true', async () => {
      const supervisor = new GroupOrchestrationSupervisor(defaultConfig);
      const state = createMockState();

      const result: ExecutorResult = {
        type: 'supervisor_decided',
        payload: {
          decision: 'broadcast',
          params: {
            agentIds: ['agent-1', 'agent-2'],
            instruction: 'Discuss',
            toolMessageId: 'tool-msg-1',
          },
          skipCallSupervisor: false,
        },
      };

      const instruction = await supervisor.decide(result, state);

      expect(instruction).toEqual({
        type: 'parallel_call_agents',
        payload: {
          agentIds: ['agent-1', 'agent-2'],
          // Broadcast agents should have tools disabled by default
          disableTools: true,
          instruction: 'Discuss',
          toolMessageId: 'tool-msg-1',
        },
      });
    });

    it('should return delegate instruction for delegate decision', async () => {
      const supervisor = new GroupOrchestrationSupervisor(defaultConfig);
      const state = createMockState();

      const result: ExecutorResult = {
        type: 'supervisor_decided',
        payload: {
          decision: 'delegate',
          params: { agentId: 'specialist-agent', reason: 'Expert needed' },
          skipCallSupervisor: false,
        },
      };

      const instruction = await supervisor.decide(result, state);

      expect(instruction).toEqual({
        type: 'delegate',
        payload: {
          agentId: 'specialist-agent',
          reason: 'Expert needed',
        },
      });
    });

    it('should return exec_async_task instruction for execute_task decision', async () => {
      const supervisor = new GroupOrchestrationSupervisor(defaultConfig);
      const state = createMockState();

      const result: ExecutorResult = {
        type: 'supervisor_decided',
        payload: {
          decision: 'execute_task',
          params: {
            agentId: 'agent-1',
            instruction: 'Analyze data',
            timeout: 30000,
            toolMessageId: 'tool-msg-1',
          },
          skipCallSupervisor: false,
        },
      };

      const instruction = await supervisor.decide(result, state);

      expect(instruction).toEqual({
        type: 'exec_async_task',
        payload: {
          agentId: 'agent-1',
          instruction: 'Analyze data',
          timeout: 30000,
          title: undefined,
          toolMessageId: 'tool-msg-1',
        },
      });
    });

    it('should include title in exec_async_task instruction when provided', async () => {
      const supervisor = new GroupOrchestrationSupervisor(defaultConfig);
      const state = createMockState();

      const result: ExecutorResult = {
        type: 'supervisor_decided',
        payload: {
          decision: 'execute_task',
          params: {
            agentId: 'agent-1',
            instruction: 'Analyze data',
            timeout: 30000,
            title: 'Data Analysis Task',
            toolMessageId: 'tool-msg-1',
          },
          skipCallSupervisor: false,
        },
      };

      const instruction = await supervisor.decide(result, state);

      expect(instruction).toEqual({
        type: 'exec_async_task',
        payload: {
          agentId: 'agent-1',
          instruction: 'Analyze data',
          timeout: 30000,
          title: 'Data Analysis Task',
          toolMessageId: 'tool-msg-1',
        },
      });
    });

    it('should return finish instruction for finish decision', async () => {
      const supervisor = new GroupOrchestrationSupervisor(defaultConfig);
      const state = createMockState();

      const result: ExecutorResult = {
        type: 'supervisor_decided',
        payload: {
          decision: 'finish',
          params: { reason: 'Task complete' },
          skipCallSupervisor: false,
        },
      };

      const instruction = await supervisor.decide(result, state);

      expect(instruction).toEqual({
        type: 'finish',
        reason: 'Task complete',
      });
    });
  });

  describe('decide - agent_spoke result', () => {
    it('should return call_supervisor instruction when skipCallSupervisor is false', async () => {
      const supervisor = new GroupOrchestrationSupervisor(defaultConfig);
      const state = createMockState();

      // First, set up the supervisor state by processing a supervisor_decided result
      await supervisor.decide(
        {
          type: 'supervisor_decided',
          payload: {
            decision: 'speak',
            params: { agentId: 'agent-1' },
            skipCallSupervisor: false,
          },
        },
        state,
      );

      // Now process agent_spoke
      const result: ExecutorResult = {
        type: 'agent_spoke',
        payload: { agentId: 'agent-1', completed: true },
      };

      const instruction = await supervisor.decide(result, state);

      expect(instruction.type).toBe('call_supervisor');
      expect((instruction as any).payload.round).toBe(1);
    });

    it('should return finish instruction when skipCallSupervisor is true', async () => {
      const supervisor = new GroupOrchestrationSupervisor(defaultConfig);
      const state = createMockState();

      // Set up with skipCallSupervisor: true
      await supervisor.decide(
        {
          type: 'supervisor_decided',
          payload: {
            decision: 'speak',
            params: { agentId: 'agent-1' },
            skipCallSupervisor: true,
          },
        },
        state,
      );

      // Now process agent_spoke
      const result: ExecutorResult = {
        type: 'agent_spoke',
        payload: { agentId: 'agent-1', completed: true },
      };

      const instruction = await supervisor.decide(result, state);

      expect(instruction).toEqual({
        type: 'finish',
        reason: 'skip_call_supervisor',
      });
    });

    it('should return finish instruction when max rounds exceeded', async () => {
      const config: GroupOrchestrationSupervisorConfig = {
        maxRounds: 2,
        supervisorAgentId: 'supervisor-agent-1',
      };
      const supervisor = new GroupOrchestrationSupervisor(config);
      const state = createMockState();

      // Process two rounds
      await supervisor.decide(
        {
          type: 'supervisor_decided',
          payload: { decision: 'speak', params: { agentId: 'agent-1' }, skipCallSupervisor: false },
        },
        state,
      );
      await supervisor.decide(
        { type: 'agent_spoke', payload: { agentId: 'agent-1', completed: true } },
        state,
      );

      await supervisor.decide(
        {
          type: 'supervisor_decided',
          payload: { decision: 'speak', params: { agentId: 'agent-1' }, skipCallSupervisor: false },
        },
        state,
      );
      const instruction = await supervisor.decide(
        { type: 'agent_spoke', payload: { agentId: 'agent-1', completed: true } },
        state,
      );

      expect(instruction).toEqual({
        type: 'finish',
        reason: 'max_rounds_exceeded',
      });
    });
  });

  describe('decide - agents_broadcasted result', () => {
    it('should return call_supervisor instruction when skipCallSupervisor is false', async () => {
      const supervisor = new GroupOrchestrationSupervisor(defaultConfig);
      const state = createMockState();

      // Set up with skipCallSupervisor: false
      await supervisor.decide(
        {
          type: 'supervisor_decided',
          payload: {
            decision: 'broadcast',
            params: { agentIds: ['agent-1', 'agent-2'], toolMessageId: 'tool-1' },
            skipCallSupervisor: false,
          },
        },
        state,
      );

      const result: ExecutorResult = {
        type: 'agents_broadcasted',
        payload: { agentIds: ['agent-1', 'agent-2'], completed: true },
      };

      const instruction = await supervisor.decide(result, state);

      expect(instruction.type).toBe('call_supervisor');
    });

    it('should return finish instruction when skipCallSupervisor is true', async () => {
      const supervisor = new GroupOrchestrationSupervisor(defaultConfig);
      const state = createMockState();

      // Set up with skipCallSupervisor: true
      await supervisor.decide(
        {
          type: 'supervisor_decided',
          payload: {
            decision: 'broadcast',
            params: { agentIds: ['agent-1', 'agent-2'], toolMessageId: 'tool-1' },
            skipCallSupervisor: true,
          },
        },
        state,
      );

      const result: ExecutorResult = {
        type: 'agents_broadcasted',
        payload: { agentIds: ['agent-1', 'agent-2'], completed: true },
      };

      const instruction = await supervisor.decide(result, state);

      expect(instruction).toEqual({
        type: 'finish',
        reason: 'skip_call_supervisor',
      });
    });
  });

  describe('decide - task_completed result', () => {
    it('should return call_supervisor instruction when skipCallSupervisor is false', async () => {
      const supervisor = new GroupOrchestrationSupervisor(defaultConfig);
      const state = createMockState();

      // Set up with skipCallSupervisor: false
      await supervisor.decide(
        {
          type: 'supervisor_decided',
          payload: {
            decision: 'execute_task',
            params: { agentId: 'agent-1', instruction: 'Do something', toolMessageId: 'tool-1' },
            skipCallSupervisor: false,
          },
        },
        state,
      );

      const result: ExecutorResult = {
        type: 'task_completed',
        payload: { agentId: 'agent-1', success: true },
      };

      const instruction = await supervisor.decide(result, state);

      expect(instruction.type).toBe('call_supervisor');
    });
  });

  describe('decide - execute_tasks decision', () => {
    it('should return batch_exec_async_tasks instruction for execute_tasks decision', async () => {
      // Regression test: execute_tasks decision should return batch_exec_async_tasks instruction
      // Previously, execute_tasks was not implemented and would fall through to default case,
      // returning { type: 'finish', reason: 'unknown_decision: execute_tasks' }
      const supervisor = new GroupOrchestrationSupervisor(defaultConfig);
      const state = createMockState();

      const result: ExecutorResult = {
        type: 'supervisor_decided',
        payload: {
          decision: 'execute_tasks',
          params: {
            tasks: [
              { agentId: 'agent-1', title: 'Task 1', instruction: 'Do task 1' },
              { agentId: 'agent-2', title: 'Task 2', instruction: 'Do task 2' },
            ],
            toolMessageId: 'tool-msg-1',
          },
          skipCallSupervisor: false,
        },
      };

      const instruction = await supervisor.decide(result, state);

      // Should return batch_exec_async_tasks, NOT finish with unknown_decision
      expect(instruction.type).toBe('batch_exec_async_tasks');
      expect((instruction as any).payload).toEqual({
        tasks: [
          { agentId: 'agent-1', title: 'Task 1', instruction: 'Do task 1' },
          { agentId: 'agent-2', title: 'Task 2', instruction: 'Do task 2' },
        ],
        toolMessageId: 'tool-msg-1',
      });
    });

    it('should handle execute_tasks with skipCallSupervisor flag', async () => {
      const supervisor = new GroupOrchestrationSupervisor(defaultConfig);
      const state = createMockState();

      // First, trigger execute_tasks with skipCallSupervisor: true
      await supervisor.decide(
        {
          type: 'supervisor_decided',
          payload: {
            decision: 'execute_tasks',
            params: {
              tasks: [{ agentId: 'agent-1', title: 'Task 1', instruction: 'Do task 1' }],
              toolMessageId: 'tool-msg-1',
            },
            skipCallSupervisor: true,
          },
        },
        state,
      );

      // When tasks_completed, should finish (not call supervisor again)
      const result: ExecutorResult = {
        type: 'tasks_completed',
        payload: { results: [{ agentId: 'agent-1', success: true }] },
      };

      const instruction = await supervisor.decide(result, state);

      expect(instruction).toEqual({
        type: 'finish',
        reason: 'skip_call_supervisor',
      });
    });
  });

  describe('decide - delegated result', () => {
    it('should always return finish instruction', async () => {
      const supervisor = new GroupOrchestrationSupervisor(defaultConfig);
      const state = createMockState();

      const result: ExecutorResult = {
        type: 'delegated',
        payload: { agentId: 'specialist-agent', completed: true },
      };

      const instruction = await supervisor.decide(result, state);

      expect(instruction).toEqual({
        type: 'finish',
        reason: 'delegated_to_specialist-agent',
      });
    });
  });

  describe('decide - unknown result type', () => {
    it('should return finish instruction with unknown_result_type reason', async () => {
      const supervisor = new GroupOrchestrationSupervisor(defaultConfig);
      const state = createMockState();

      const result = { type: 'unknown_type', payload: {} } as any;

      const instruction = await supervisor.decide(result, state);

      expect(instruction).toEqual({
        type: 'finish',
        reason: 'unknown_result_type',
      });
    });
  });

  describe('IGroupOrchestrationSupervisor interface compliance', () => {
    it('should implement decide method that returns Promise<SupervisorInstruction>', async () => {
      const supervisor = new GroupOrchestrationSupervisor(defaultConfig);
      const state = createMockState();

      const result: ExecutorResult = {
        type: 'init',
        payload: { groupId: 'g1' },
      };

      const promise = supervisor.decide(result, state);

      // Should return a Promise
      expect(promise).toBeInstanceOf(Promise);

      // Should resolve to an instruction
      const instruction = await promise;
      expect(instruction).toHaveProperty('type');
    });
  });
});
