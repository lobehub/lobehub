import { describe, expect, it } from 'vitest';

import { parse } from '../parse';
import type { Message } from '../types/shared';
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

    it('should keep assistant tool results scoped when tool call IDs repeat', () => {
      const result = parse([
        {
          content: 'Current request',
          createdAt: 0,
          id: 'user-current',
          role: 'user',
          updatedAt: 0,
        },
        {
          agentId: 'agent-1',
          content: 'First step',
          createdAt: 1,
          id: 'assistant-current-1',
          parentId: 'user-current',
          role: 'assistant',
          tools: [
            {
              apiName: 'command_execution',
              arguments: '{}',
              id: 'item_1',
              identifier: 'codex',
              result_msg_id: 'tool-current-1',
              type: 'default',
            },
          ],
          updatedAt: 1,
        },
        {
          content: 'Current tool result',
          createdAt: 2,
          id: 'tool-current-1',
          parentId: 'assistant-current-1',
          role: 'tool',
          tool_call_id: 'item_1',
          updatedAt: 2,
        },
        {
          agentId: 'agent-1',
          content: 'Second step',
          createdAt: 3,
          id: 'assistant-current-2',
          parentId: 'tool-current-1',
          role: 'assistant',
          tools: [
            {
              apiName: 'command_execution',
              arguments: '{}',
              id: 'item_2',
              identifier: 'codex',
              result_msg_id: 'tool-current-2',
              type: 'default',
            },
          ],
          updatedAt: 3,
        },
        {
          content: 'Second tool result',
          createdAt: 4,
          id: 'tool-current-2',
          parentId: 'assistant-current-2',
          role: 'tool',
          tool_call_id: 'item_2',
          updatedAt: 4,
        },
        {
          agentId: 'agent-1',
          content: 'Final summary',
          createdAt: 5,
          id: 'assistant-current-final',
          parentId: 'tool-current-2',
          role: 'assistant',
          updatedAt: 5,
        },
        {
          content: 'Later request',
          createdAt: 6,
          id: 'user-later',
          role: 'user',
          updatedAt: 6,
        },
        {
          agentId: 'agent-1',
          content: 'Another turn reuses Codex item ids',
          createdAt: 7,
          id: 'assistant-later',
          parentId: 'user-later',
          role: 'assistant',
          tools: [
            {
              apiName: 'command_execution',
              arguments: '{}',
              id: 'item_1',
              identifier: 'codex',
              result_msg_id: 'tool-later-1',
              type: 'default',
            },
          ],
          updatedAt: 7,
        },
        {
          content: 'Later tool result',
          createdAt: 8,
          id: 'tool-later-1',
          parentId: 'assistant-later',
          role: 'tool',
          tool_call_id: 'item_1',
          updatedAt: 8,
        },
      ]);

      const currentGroup = result.flatList.find((message) => message.id === 'assistant-current-1');

      expect(currentGroup?.role).toBe('assistantGroup');
      expect((currentGroup as any).children.map((child: any) => child.id)).toEqual([
        'assistant-current-1',
        'assistant-current-2',
        'assistant-current-final',
      ]);
      expect((currentGroup as any).children[0].tools[0].result_msg_id).toBe('tool-current-1');
    });

    it('should keep sibling assistant continuations before later user turns under another tool result', () => {
      const time = (seconds: number) =>
        new Date(`2026-01-01T00:00:${String(seconds).padStart(2, '0')}.000Z`).getTime();
      const messages: Message[] = [
        { content: 'root', createdAt: time(0), id: 'u0', role: 'user', updatedAt: time(0) },
        {
          content: 'assistant with two tools',
          createdAt: time(1),
          id: 'a0',
          parentId: 'u0',
          role: 'assistant',
          tools: [
            {
              apiName: 'update',
              arguments: '{}',
              id: 'tc-later',
              identifier: 'internal',
              result_msg_id: 'tool-later',
              type: 'default',
            },
            {
              apiName: 'read',
              arguments: '{}',
              id: 'tc-first',
              identifier: 'internal',
              result_msg_id: 'tool-first',
              type: 'default',
            },
          ],
          updatedAt: time(1),
        },
        {
          content: 'todo updated',
          createdAt: time(2),
          id: 'tool-later',
          parentId: 'a0',
          role: 'tool',
          tool_call_id: 'tc-later',
          updatedAt: time(2),
        },
        {
          content: 'context result',
          createdAt: time(3),
          id: 'tool-first',
          parentId: 'a0',
          role: 'tool',
          tool_call_id: 'tc-first',
          updatedAt: time(3),
        },
        {
          content: 'summary before question',
          createdAt: time(4),
          id: 'summary',
          parentId: 'tool-first',
          role: 'assistant',
          updatedAt: time(4),
        },
        {
          content: 'Earlier assistant continuation',
          createdAt: time(5),
          id: 'first-question',
          parentId: 'tool-first',
          role: 'assistant',
          updatedAt: time(5),
        },
        {
          content: 'later answer',
          createdAt: time(6),
          id: 'later-answer',
          parentId: 'tool-later',
          role: 'assistant',
          updatedAt: time(6),
        },
        {
          content: 'Later user follow-up',
          createdAt: time(7),
          id: 'status-user',
          parentId: 'tool-later',
          role: 'user',
          updatedAt: time(7),
        },
        {
          content: '...',
          createdAt: time(8),
          id: 'status-assistant',
          parentId: 'status-user',
          role: 'assistant',
          updatedAt: time(8),
        },
      ];

      const result = parse(messages);
      const ids = result.flatList.map((message) => message.id);

      // ROOT CAUSE:
      //
      // If one assistantGroup owns multiple tool results, and one tool result has
      // multiple assistant children while another tool result later receives user
      // turns, FlatListBuilder currently walks the other tool result first. That
      // renders later user turns before the earlier assistant continuation.
      //
      // We fixed this by preserving the chronological continuation order across
      // sibling tool-result children instead of deferring the second assistant.
      expect(ids.indexOf('first-question')).toBeLessThan(ids.indexOf('status-user'));
    });

    it('should interleave continuations from sibling tool results by child creation time', () => {
      const time = (seconds: number) =>
        new Date(`2026-01-01T00:01:${String(seconds).padStart(2, '0')}.000Z`).getTime();
      const messages: Message[] = [
        { content: 'root', createdAt: time(0), id: 'u0', role: 'user', updatedAt: time(0) },
        {
          content: 'assistant with sibling tools',
          createdAt: time(1),
          id: 'a0',
          parentId: 'u0',
          role: 'assistant',
          tools: [
            {
              apiName: 'first',
              arguments: '{}',
              id: 'tc-a',
              identifier: 'internal',
              result_msg_id: 'tool-a',
              type: 'default',
            },
            {
              apiName: 'second',
              arguments: '{}',
              id: 'tc-b',
              identifier: 'internal',
              result_msg_id: 'tool-b',
              type: 'default',
            },
          ],
          updatedAt: time(1),
        },
        {
          content: 'tool a result',
          createdAt: time(2),
          id: 'tool-a',
          parentId: 'a0',
          role: 'tool',
          tool_call_id: 'tc-a',
          updatedAt: time(2),
        },
        {
          content: 'tool b result',
          createdAt: time(3),
          id: 'tool-b',
          parentId: 'a0',
          role: 'tool',
          tool_call_id: 'tc-b',
          updatedAt: time(3),
        },
        {
          content: 'first user continuation',
          createdAt: time(4),
          id: 'tool-a-first',
          parentId: 'tool-a',
          role: 'user',
          updatedAt: time(4),
        },
        {
          content: 'middle user continuation',
          createdAt: time(5),
          id: 'tool-b-middle',
          parentId: 'tool-b',
          role: 'user',
          updatedAt: time(5),
        },
        {
          content: 'last user continuation',
          createdAt: time(6),
          id: 'tool-a-last',
          parentId: 'tool-a',
          role: 'user',
          updatedAt: time(6),
        },
      ];

      const result = parse(messages);
      const ids = result.flatList.map((message) => message.id);

      expect(ids.indexOf('tool-a-first')).toBeLessThan(ids.indexOf('tool-b-middle'));
      expect(ids.indexOf('tool-b-middle')).toBeLessThan(ids.indexOf('tool-a-last'));
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

    // Regression: the supervisor's post-council reply must surface no matter which council
    // member it parents to. Broadcast agents finish near-simultaneously (tied createdAt), so
    // the writer's createdAt-last member can differ from the array order; previously the reader
    // only walked the last member and stranded the reply, making the supervisor message vanish.
    it.each([['msg-agent-backend-1'], ['msg-agent-devops-1'], ['msg-agent-architect-1']])(
      'should surface supervisor final reply when it parents to council member %s',
      (memberId) => {
        const messages = inputs.agentCouncil.withSupervisorReply.map((message) =>
          message.id === 'msg-supervisor-summary'
            ? { ...message, parentId: memberId }
            : message,
        );

        const result = parse(messages);
        const summary = result.flatList.find((m) => m.id === 'msg-supervisor-summary');

        expect(summary).toBeDefined();
        expect(summary!.role).toBe('supervisor');
        // No duplication regardless of which member carries the reply
        expect(result.flatList.filter((m) => m.id === 'msg-supervisor-summary')).toHaveLength(1);

        // contextTree must stay in agreement with flatList — the reply has to surface in
        // both exported views, otherwise a contextTree consumer still sees the chain vanish.
        const collectIds = (nodes: any[], acc: string[] = []): string[] => {
          for (const node of nodes) {
            if (node.id) acc.push(node.id);
            if (Array.isArray(node.members)) collectIds(node.members, acc);
            if (Array.isArray(node.children)) collectIds(node.children, acc);
            if (Array.isArray(node.columns)) collectIds(node.columns, acc);
          }
          return acc;
        };
        const contextIds = collectIds(result.contextTree as any[]);
        expect(contextIds).toContain('msg-supervisor-summary');
        expect(contextIds.filter((id) => id === 'msg-supervisor-summary')).toHaveLength(1);
      },
    );
  });

  describe('Assistant Group Scenarios', () => {
    it('should handle tools with assistant branches correctly', () => {
      const result = parse(inputs.assistantGroup.toolsWithBranches);

      expect(serializeParseResult(result)).toEqual(outputs.assistantGroup.toolsWithBranches);
    });

    // Regression: a hetero-agent (e.g. Claude Code) turn often opens with a
    // TOOLLESS narration step streamed in reply to the user BEFORE the first
    // tool call, with the tool-using step as its direct child. Previously the
    // toolless head fell through to "Priority 4: regular message" and rendered
    // as its own standalone bubble, while the tool step opened a SEPARATE
    // assistantGroup — so the UI showed two disconnected assistant cards (a
    // visually broken chain). The head must instead seed the single
    // assistantGroup.
    it('should fold a toolless turn-head into the following tool chain (single group)', () => {
      const messages: Message[] = [
        {
          content: 'Can you check the build status?',
          createdAt: 0,
          id: 'u1',
          role: 'user',
          updatedAt: 0,
        },
        {
          content: 'Sure — let me first find where the CI config lives.',
          createdAt: 1,
          id: 'a-head', // toolless narration, parent is the user message
          parentId: 'u1',
          role: 'assistant',
          updatedAt: 1,
        },
        {
          content: 'Found it. Reading the workflow file now.',
          createdAt: 2,
          id: 'a-tool',
          parentId: 'a-head', // direct child of the toolless head
          role: 'assistant',
          tools: [
            { apiName: 'readFile', arguments: '{}', id: 't1', identifier: 'fs', type: 'default' },
          ],
          updatedAt: 2,
        },
        {
          content: 'name: CI\non: [push]',
          createdAt: 3,
          id: 't1',
          parentId: 'a-tool',
          role: 'tool',
          tool_call_id: 't1',
          updatedAt: 3,
        },
        {
          content: 'The build runs on every push and is currently green.',
          createdAt: 4,
          id: 'a-final',
          parentId: 't1',
          role: 'assistant',
          updatedAt: 4,
        },
      ] as Message[];

      const result = parse(messages);

      // user + ONE assistantGroup (not user + standalone assistant + group)
      expect(result.flatList).toHaveLength(2);
      expect(result.flatList[0].id).toBe('u1');
      expect(result.flatList[1].role).toBe('assistantGroup');

      // The toolless head is the first child of the group, with its prose intact,
      // followed by the tool step and the final answer — all in one card.
      const children = (result.flatList[1] as any).children;
      expect(children.map((c: any) => c.id)).toEqual(['a-head', 'a-tool', 'a-final']);
      expect(children[0].content).toBe('Sure — let me first find where the CI config lives.');
      expect(children[0].tools).toBeUndefined();
      expect(children[1].tools[0].result_msg_id).toBe('t1');
    });

    // Guard for the narrow scope above: when MORE than one toolless prose step
    // precedes the first tool call, the head is NOT folded. collectAssistantChain
    // stops at the first toolless continuation, so folding here would emit a
    // tools-less assistantGroup and still leave the tool step split. The multi-
    // prose prelude must instead stay as plain assistant bubbles — and crucially
    // we must never produce an assistantGroup with no tools.
    it('should not fold a multi-step toolless prelude (no tools-less assistantGroup)', () => {
      const messages: Message[] = [
        {
          content: 'Can you check the build status?',
          createdAt: 0,
          id: 'u1',
          role: 'user',
          updatedAt: 0,
        },
        {
          content: 'Sure, let me think about where to look.',
          createdAt: 1,
          id: 'a-head', // toolless, parent is the user message
          parentId: 'u1',
          role: 'assistant',
          updatedAt: 1,
        },
        {
          content: 'The CI config is probably under .github/workflows.',
          createdAt: 2,
          id: 'a-prose', // SECOND toolless prose step before any tool
          parentId: 'a-head',
          role: 'assistant',
          updatedAt: 2,
        },
        {
          content: 'Reading it now.',
          createdAt: 3,
          id: 'a-tool',
          parentId: 'a-prose',
          role: 'assistant',
          tools: [
            { apiName: 'readFile', arguments: '{}', id: 't1', identifier: 'fs', type: 'default' },
          ],
          updatedAt: 3,
        },
        {
          content: 'name: CI',
          createdAt: 4,
          id: 't1',
          parentId: 'a-tool',
          role: 'tool',
          tool_call_id: 't1',
          updatedAt: 4,
        },
      ] as Message[];

      const result = parse(messages);

      // No assistantGroup may exist without tools in any of its children.
      const toollessGroups = result.flatList.filter(
        (m) =>
          m.role === 'assistantGroup' &&
          ((m as any).children ?? []).every((c: any) => !c.tools || c.tools.length === 0),
      );
      expect(toollessGroups).toHaveLength(0);

      // The two prose steps render as plain assistant bubbles; the tool step
      // forms its own (well-formed) assistantGroup.
      const head = result.flatList.find((m) => m.id === 'a-head');
      expect(head?.role).toBe('assistant');
      const toolGroup = result.flatList.find((m) => m.id === 'a-tool');
      expect(toolGroup?.role).toBe('assistantGroup');
      expect((toolGroup as any).children[0].tools[0].result_msg_id).toBe('t1');
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

    it('should handle single sub-agent (callSubAgent) with tool chain after completion', () => {
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
