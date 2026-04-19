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

  describe('Compression', () => {
    it('should keep follow-up chain visible after compressedGroup from recursive tool result', () => {
      // Data provenance:
      // - The compressedGroup + nested assistant/tool structure is abstracted from the
      //   real `lh eval message list` output after we fixed the CLI/router to expose
      //   full compression data.
      // - That output models the async eval path: long-running search/tool chains that
      //   later get compressed by the backend before follow-up steps continue.
      // - We intentionally keep the sample minimal while preserving the real eval traits:
      //   compressed history, assistant/tool chaining, and tool result message redirection.
      const messages = [
        {
          compressedMessages: [
            {
              content:
                'I was reviewing the list of winners of a prestigious international prize...',
              id: 'msg-user-hidden',
              role: 'user',
            },
            {
              content: '',
              id: 'msg-assistant-hidden',
              role: 'assistantGroup',
              tools: [
                {
                  id: 'tool-call-1',
                  result_msg_id: 'msg-tool-hidden',
                },
              ],
            },
          ],
          content: 'Compressed summary of earlier search steps',
          createdAt: 1000,
          id: 'comp-group-1',
          pinnedMessages: [],
          role: 'compressedGroup',
          updatedAt: 1000,
        },
        {
          content: 'John Clarke was born in the United Kingdom, not the USA.',
          createdAt: 2000,
          id: 'msg-follow-up-1',
          parentId: 'msg-tool-hidden',
          role: 'assistant',
          updatedAt: 2000,
        },
        {
          content: '',
          createdAt: 3000,
          id: 'msg-follow-up-2',
          parentId: 'msg-follow-up-1',
          role: 'assistant',
          tools: [
            {
              apiName: 'search',
              arguments: '{}',
              id: 'tool-call-2',
              identifier: 'lobe-web-browsing',
              type: 'builtin',
            },
          ],
          updatedAt: 3000,
        },
        {
          content: '<searchResults><item title="MIT Nobel Prize winners" /></searchResults>',
          createdAt: 4000,
          id: 'msg-tool-2',
          parentId: 'msg-follow-up-2',
          role: 'tool',
          tool_call_id: 'tool-call-2',
          updatedAt: 4000,
        },
      ] as any[];

      const result = parse(messages);

      expect(result.flatList).toHaveLength(3);
      expect(result.flatList[0].id).toBe('comp-group-1');
      expect(result.flatList[0].role).toBe('compressedGroup');
      expect(result.flatList[1].id).toBe('msg-follow-up-1');
      expect(result.flatList[2].role).toBe('assistantGroup');
      expect((result.flatList[2] as any).children).toHaveLength(1);
      expect((result.flatList[2] as any).children[0].id).toBe('msg-follow-up-2');
      expect((result.flatList[2] as any).children[0].tools[0].result_msg_id).toBe('msg-tool-2');

      expect(result.contextTree.map((node) => node.id)).toEqual([
        'comp-group-1',
        'msg-follow-up-1',
        'msg-follow-up-2',
      ]);
      expect(result.messageMap['msg-follow-up-2']).toBeDefined();
    });

    it('should keep orphan follow-up chain as root when compressed parent is missing', () => {
      // Data provenance:
      // - This case is derived from the current frontend chat continuation behavior:
      //   after compression, a follow-up request may be queried without the original
      //   compressed parent message still being present in the current message slice.
      // - It represents the synchronous chat path, where UI queries a partial window and
      //   still needs the remaining visible chain instead of dropping it as an orphan.
      const messages = [
        {
          content: 'Continue the Nobel Prize search',
          createdAt: 1000,
          id: 'msg-follow-up-1',
          parentId: 'msg-compressed-hidden',
          role: 'user',
          updatedAt: 1000,
        },
        {
          content: 'I will check the laureates by institution.',
          createdAt: 2000,
          id: 'msg-follow-up-2',
          parentId: 'msg-follow-up-1',
          role: 'assistant',
          updatedAt: 2000,
        },
      ] as any[];

      const result = parse(messages);

      expect(result.flatList).toHaveLength(2);
      expect(result.flatList[0].id).toBe('msg-follow-up-1');
      expect(result.flatList[1].id).toBe('msg-follow-up-2');
      expect(result.contextTree.map((node) => node.id)).toEqual([
        'msg-follow-up-1',
        'msg-follow-up-2',
      ]);
      expect(result.messageMap['msg-follow-up-1'].parentId).toBe('msg-compressed-hidden');
    });
  });

  describe('Usage promotion', () => {
    it('should promote metadata.usage onto the top-level usage field', () => {
      // UIChatMessage consumers (Extras token badge, tokenCounter) read from
      // the top-level `usage` field, but executors only write to
      // `metadata.usage`. `parse` is the single renderer-side transform that
      // every read flows through, so it owns the promotion.
      const usage = {
        inputCacheMissTokens: 6,
        inputCachedTokens: 16204,
        inputWriteCacheTokens: 13964,
        totalInputTokens: 30174,
        totalOutputTokens: 265,
        totalTokens: 30439,
      };
      const input = [
        {
          id: 'u1',
          role: 'user' as const,
          content: 'hi',
          createdAt: 1,
        },
        {
          id: 'a1',
          role: 'assistant' as const,
          content: 'hello',
          parentId: 'u1',
          metadata: { usage },
          createdAt: 2,
        },
      ];

      const result = parse(input as any[]);
      const assistant = result.flatList.find((m) => m.id === 'a1');
      expect(assistant?.usage).toEqual(usage);
    });

    it('should not overwrite an existing top-level usage', () => {
      // If a message already carries a top-level `usage` (e.g. aggregated
      // group-level total), we keep it — `metadata.usage` is only a fallback.
      const topLevelUsage = { totalTokens: 999, totalInputTokens: 900, totalOutputTokens: 99 };
      const metaUsage = { totalTokens: 1, totalInputTokens: 1, totalOutputTokens: 0 };
      const input = [
        {
          id: 'a1',
          role: 'assistant' as const,
          content: 'hi',
          createdAt: 1,
          usage: topLevelUsage,
          metadata: { usage: metaUsage },
        },
      ];

      const result = parse(input as any[]);
      expect(result.flatList[0]?.usage).toEqual(topLevelUsage);
    });

    it('should aggregate per-step nested metadata.usage across an assistantGroup chain', () => {
      // Hetero-agent (Claude Code) writes per-turn usage to `metadata.usage` on
      // each step assistant message. The assistantGroup virtual message must
      // sum them — without this, the UI shows only one step's tokens (typically
      // the last step, which gets surfaced via the lone metadata.usage that
      // survived Object.assign collapse).
      const step1Usage = {
        inputCachedTokens: 100,
        totalInputTokens: 200,
        totalOutputTokens: 50,
        totalTokens: 250,
      };
      const step2Usage = {
        inputCachedTokens: 300,
        totalInputTokens: 400,
        totalOutputTokens: 80,
        totalTokens: 480,
      };
      const input = [
        {
          id: 'u1',
          role: 'user' as const,
          content: 'q',
          createdAt: 1,
        },
        {
          id: 'a1',
          role: 'assistant' as const,
          content: '',
          parentId: 'u1',
          tools: [{ id: 'call-1', type: 'default', apiName: 'bash', arguments: '{}' }],
          metadata: { usage: step1Usage },
          createdAt: 2,
        },
        {
          id: 't1',
          role: 'tool' as const,
          content: 'tool output',
          parentId: 'a1',
          tool_call_id: 'call-1',
          createdAt: 3,
        },
        {
          id: 'a2',
          role: 'assistant' as const,
          content: 'final answer',
          parentId: 't1',
          metadata: { usage: step2Usage },
          createdAt: 4,
        },
      ];

      const result = parse(input as any[]);
      const group = result.flatList.find((m) => m.role === 'assistantGroup');
      expect(group?.usage).toEqual({
        inputCachedTokens: 400,
        totalInputTokens: 600,
        totalOutputTokens: 130,
        totalTokens: 730,
      });
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
