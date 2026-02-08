import { describe, expect, it } from 'vitest';

import { parse } from '../parse';
import { inputs, outputs } from './fixtures';

function serializeParseResult(result: ReturnType<typeof parse>) {
  return {
    contextTree: result.contextTree,
    flatList: result.flatList,
    messageMap: result.messageMap,
  };
}

describe('parse', () => {
  describe('Basic Conversations', () => {
    it('should parse linear conversation correctly', () => {
      const result = parse(inputs.linearConversation);

      expect(serializeParseResult(result)).toEqual(outputs.linearConversation);
    });
  });

  describe('Tool Usage', () => {
    it('should parse assistant with tools correctly', () => {
      const result = parse(inputs.assistantGroup.assistantWithTools);

      expect(serializeParseResult(result)).toEqual(outputs.assistantGroup.assistantWithTools);
    });

    it('should include follow-up messages after assistant chain', () => {
      const result = parse(inputs.assistantChainWithFollowup);

      // The critical assertion: flatList should contain all 5 messages
      // msg-1 (user) + assistantGroup (msg-2+msg-3+tool-1) + msg-4 (user follow-up)
      expect(result.flatList).toHaveLength(3);
      expect(result.flatList[0].id).toBe('msg-1');
      expect(result.flatList[1].role).toBe('assistantGroup');
      expect(result.flatList[2].id).toBe('msg-4'); // This is the critical one that might be missing

      expect(serializeParseResult(result)).toEqual(outputs.assistantChainWithFollowup);
    });
  });

  describe('Branching', () => {
    it('should parse branched conversation correctly', () => {
      const result = parse(inputs.branch.conversation);

      expect(serializeParseResult(result)).toEqual(outputs.branch.conversation);
    });

    it('should respect activeBranchIndex when specified', () => {
      const result = parse(inputs.branch.activeIndex1);

      expect(serializeParseResult(result)).toEqual(outputs.branch.activeIndex1);
    });

    it('should handle assistant message with branches', () => {
      const result = parse(inputs.branch.assistantBranch);

      expect(serializeParseResult(result)).toEqual(outputs.branch.assistantBranch);
    });

    it('should handle assistant with user branches', () => {
      const result = parse(inputs.branch.assistantUserBranch);

      expect(serializeParseResult(result)).toEqual(outputs.branch.assistantUserBranch);
    });

    it('should handle deeply nested branches (4 levels)', () => {
      const result = parse(inputs.branch.nested);

      expect(serializeParseResult(result)).toEqual(outputs.branch.nested);
    });

    it('should handle multiple assistant group branches', () => {
      const result = parse(inputs.branch.multiAssistantGroup);

      expect(serializeParseResult(result)).toEqual(outputs.branch.multiAssistantGroup);
    });

    it('should handle assistant group with branches', () => {
      const result = parse(inputs.branch.assistantGroupBranches);

      expect(serializeParseResult(result)).toEqual(outputs.branch.assistantGroupBranches);
    });
  });

  describe('Compare Mode', () => {
    it('should parse simple compare mode correctly', () => {
      const result = parse(inputs.compare.simple);

      expect(serializeParseResult(result)).toEqual(outputs.compare.simple);
    });

    it('should parse compare mode with tools correctly', () => {
      const result = parse(inputs.compare.withTools);

      expect(serializeParseResult(result)).toEqual(outputs.compare.withTools);
    });
  });

  describe('AgentCouncil Mode', () => {
    it('should parse simple agentCouncil (broadcast) correctly', () => {
      const result = parse(inputs.agentCouncil.simple);

      expect(serializeParseResult(result)).toEqual(outputs.agentCouncil.simple);
    });

    it('should parse agentCouncil with supervisor final reply correctly', () => {
      const result = parse(inputs.agentCouncil.withSupervisorReply);

      // The critical assertions:
      // 1. flatList should have 4 items: user, supervisor(+tool), agentCouncil(3 agents), supervisor-summary
      expect(result.flatList).toHaveLength(4);
      expect(result.flatList[0].role).toBe('user');
      expect(result.flatList[1].role).toBe('supervisor'); // supervisor with tools gets role='supervisor'
      expect(result.flatList[2].role).toBe('agentCouncil');
      expect(result.flatList[3].role).toBe('supervisor'); // supervisor final reply
      expect(result.flatList[3].id).toBe('msg-supervisor-summary');

      // 2. agentCouncil should have 3 members (not 4, supervisor summary is separate)
      expect((result.flatList[2] as any).members).toHaveLength(3);

      expect(serializeParseResult(result)).toEqual(outputs.agentCouncil.withSupervisorReply);
    });
  });

  describe('Assistant Group Scenarios', () => {
    it('should handle tools with assistant branches correctly', () => {
      const result = parse(inputs.assistantGroup.toolsWithBranches);

      expect(serializeParseResult(result)).toEqual(outputs.assistantGroup.toolsWithBranches);
    });
  });

  describe('Agent Group Scenarios', () => {
    it('should not aggregate messages from different agents into same AssistantGroup', () => {
      const result = parse(inputs.agentGroup.speakDifferentAgent);

      // The critical assertions:
      // 1. flatList should have 3 items: user, supervisor(+tool), agent-backend response
      expect(result.flatList).toHaveLength(3);
      expect(result.flatList[0].role).toBe('user');
      expect(result.flatList[1].role).toBe('supervisor'); // supervisor with tools gets role='supervisor'
      expect(result.flatList[2].role).toBe('assistant');

      // 2. The agent-backend response should be separate (different agentId)
      expect(result.flatList[2].id).toBe('msg-agent-backend-1');
      expect((result.flatList[2] as any).agentId).toBe('agent-backend');

      // 3. The supervisor's group should only contain supervisor messages
      expect((result.flatList[1] as any).agentId).toBe('supervisor');

      expect(serializeParseResult(result)).toEqual(outputs.agentGroup.speakDifferentAgent);
    });

    it('should handle supervisor content-only message (no tools)', () => {
      const result = parse(inputs.agentGroup.supervisorContentOnly);

      // The critical assertions:
      // 1. The final supervisor message (content-only, no tools) should be transformed to role='supervisor'
      // 2. Its content should be moved to children array
      const supervisorSummary = result.flatList.find((m) => m.id === 'msg-supervisor-summary');
      expect(supervisorSummary).toBeDefined();
      expect(supervisorSummary?.role).toBe('supervisor');
      expect((supervisorSummary as any)?.children).toHaveLength(1);
      expect((supervisorSummary as any)?.children[0].content).toBe('调研完成！这是综合汇总报告...');
      // The top-level content should be empty
      expect(supervisorSummary?.content).toBe('');
    });

    it('should handle supervisor summary after multiple tasks (content folded into children)', () => {
      const result = parse(inputs.agentGroup.supervisorAfterMultiTasks);

      // The critical assertions:
      // 1. flatList should have: user, supervisor(+tool), groupTasks(2 tasks), supervisor-summary
      expect(result.flatList).toHaveLength(4);
      expect(result.flatList[0].role).toBe('user');
      expect(result.flatList[1].role).toBe('supervisor');
      expect(result.flatList[2].role).toBe('groupTasks');
      expect(result.flatList[3].role).toBe('supervisor');

      // 2. groupTasks should have 2 tasks
      expect((result.flatList[2] as any).tasks).toHaveLength(2);

      // 3. The supervisor summary (no tools) should have content folded into children
      const supervisorSummary = result.flatList[3];
      expect(supervisorSummary.id).toBe('msg-supervisor-summary');
      expect(supervisorSummary.content).toBe(''); // content should be empty
      expect((supervisorSummary as any).children).toHaveLength(1);
      expect((supervisorSummary as any).children[0].content).toBe('调研完成！这是综合汇总报告...');
    });
  });

  describe('Tasks Aggregation', () => {
    it('should aggregate multiple task messages with same parentId', () => {
      const result = parse(inputs.tasks.simple);

      // The critical assertions:
      // 1. flatList should have 4 items: user, assistantGroup(+tool), tasks(2 tasks), assistant-summary
      expect(result.flatList).toHaveLength(4);
      expect(result.flatList[0].role).toBe('user');
      expect(result.flatList[1].role).toBe('assistantGroup');
      expect(result.flatList[2].role).toBe('tasks');
      expect(result.flatList[3].role).toBe('assistant');

      // 2. tasks virtual message should have 2 task messages
      expect((result.flatList[2] as any).tasks).toHaveLength(2);

      // 3. contextTree should have tasks node
      const tasksNode = result.contextTree.find((node) => node.type === 'tasks');
      expect(tasksNode).toBeDefined();
      expect((tasksNode as any).children).toHaveLength(2);

      expect(serializeParseResult(result)).toEqual(outputs.tasks.simple);
    });

    it('should aggregate three task messages with summary', () => {
      const result = parse(inputs.tasks.withSummary);

      // The critical assertions:
      // 1. flatList should have 4 items: user, assistantGroup(+tool), tasks(3 tasks), assistant-summary
      expect(result.flatList).toHaveLength(4);
      expect(result.flatList[0].role).toBe('user');
      expect(result.flatList[1].role).toBe('assistantGroup');
      expect(result.flatList[2].role).toBe('tasks');
      expect(result.flatList[3].role).toBe('assistant');

      // 2. tasks virtual message should have 3 task messages
      expect((result.flatList[2] as any).tasks).toHaveLength(3);

      expect(serializeParseResult(result)).toEqual(outputs.tasks.withSummary);
    });

    it('should handle 10 parallel tasks with summary as task child', () => {
      const result = parse(inputs.tasks.multiTasksWithSummary);

      // The critical assertions:
      // 1. flatList should have 4 items: user, assistantGroup(+tool), tasks(10 tasks), assistant-summary
      expect(result.flatList).toHaveLength(4);
      expect(result.flatList[0].role).toBe('user');
      expect(result.flatList[1].role).toBe('assistantGroup');
      expect(result.flatList[2].role).toBe('tasks');
      expect(result.flatList[3].role).toBe('assistant');

      // 2. tasks virtual message should have 10 task messages
      expect((result.flatList[2] as any).tasks).toHaveLength(10);

      // 3. Verify all tasks are completed
      const tasks = (result.flatList[2] as any).tasks;
      for (const task of tasks) {
        expect(task.taskDetail.status).toBe('completed');
      }

      // 4. The summary message should be present and accessible
      expect(result.flatList[3].id).toBe('msg-assistant-summary');
      expect(result.flatList[3].content).toContain('All 10 tasks completed');
    });

    it('should handle single task (execTask) with tool chain after completion', () => {
      const result = parse(inputs.tasks.singleTaskWithToolChain);

      expect(serializeParseResult(result)).toEqual(outputs.tasks.singleTaskWithToolChain);
    });

    it('should merge assistant with tools after task into AssistantGroup', () => {
      const result = parse(inputs.tasks.withAssistantGroup);

      // The critical assertions:
      // 1. flatList should have 4 items: user, assistantGroup(+tool), tasks(3 tasks), assistantGroup(with tool chain)
      expect(result.flatList).toHaveLength(4);
      expect(result.flatList[0].role).toBe('user');
      expect(result.flatList[1].role).toBe('assistantGroup');
      expect(result.flatList[2].role).toBe('tasks');
      expect(result.flatList[3].role).toBe('assistantGroup');

      // 2. The last assistantGroup should contain the full chain:
      //    - msg-assistant-after-task (with tool)
      //    - msg-assistant-final (without tool)
      const lastGroup = result.flatList[3] as any;
      expect(lastGroup.children).toHaveLength(2);
      expect(lastGroup.children[0].id).toBe('msg-assistant-after-task');
      expect(lastGroup.children[0].tools).toBeDefined();
      expect(lastGroup.children[0].tools[0].result_msg_id).toBe('msg-tool-list-files');
      expect(lastGroup.children[1].id).toBe('msg-assistant-final');
    });
  });

  describe('Performance', () => {
    it('should parse 10000 items within 100ms', () => {
      // Generate 10000 messages as flat siblings (no deep nesting to avoid stack overflow)
      // This simulates a more realistic scenario where messages are not deeply nested
      const largeInput = Array.from({ length: 10000 }, (_, i) => ({
        id: `msg-${i}`,
        role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
        content: `Message ${i}`,
        parentId: undefined, // All messages at the same level
        createdAt: Date.now() + i,
      }));

      const startTime = performance.now();
      const result = parse(largeInput as any[]);
      const endTime = performance.now();

      const executionTime = endTime - startTime;

      expect(result.flatList.length).toBeGreaterThan(0);
      expect(executionTime).toBeLessThan(100);
    });
  });
});
