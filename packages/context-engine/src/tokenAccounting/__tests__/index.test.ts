import type { UIChatMessage } from '@lobechat/types';
import { estimateTokenCount } from 'tokenx';
import { describe, expect, it } from 'vitest';

import { DEFAULT_TEMPLATE, formatTaskMessage } from '../../processors/TaskMessage';
import { countContextTokens, DEFAULT_DRIFT_MULTIPLIER } from '../index';

// Minimal helper — UIChatMessage has many optional fields; tests only set the
// ones that affect token accounting.
const mkMsg = (m: Partial<UIChatMessage> & { role: UIChatMessage['role'] }): UIChatMessage =>
  ({
    content: '',
    createdAt: 0,
    id: 'm',
    updatedAt: 0,
    ...m,
  }) as UIChatMessage;

describe('countContextTokens', () => {
  describe('basic shape & defaults', () => {
    it('returns zero accounting for empty input', () => {
      const result = countContextTokens({ messages: [] });

      expect(result.rawTotal).toBe(0);
      expect(result.adjustedTotal).toBe(0);
      expect(result.driftMultiplier).toBe(DEFAULT_DRIFT_MULTIPLIER);
      expect(result.messages).toEqual([]);
      expect(result.tools).toEqual([]);
      expect(result.bySource).toEqual({
        content: 0,
        reasoning: 0,
        thoughtSignature: 0,
        toolCallId: 0,
        toolCalls: 0,
        toolDefinition: 0,
      });
    });

    it('respects a custom driftMultiplier', () => {
      const msgs: UIChatMessage[] = [mkMsg({ role: 'user', content: 'hello world '.repeat(100) })];
      const r1 = countContextTokens({ messages: msgs });
      const r2 = countContextTokens({ messages: msgs, options: { driftMultiplier: 1 } });

      expect(r1.rawTotal).toBe(r2.rawTotal);
      expect(r2.adjustedTotal).toBe(r2.rawTotal); // 1.0 means no adjustment
      expect(r1.adjustedTotal).toBe(Math.ceil(r1.rawTotal * DEFAULT_DRIFT_MULTIPLIER));
    });

    it('produces one breakdown entry per message in original order', () => {
      const msgs: UIChatMessage[] = [
        mkMsg({ role: 'user', content: 'a' }),
        mkMsg({ role: 'assistant', content: 'b' }),
        mkMsg({ role: 'tool', content: 'c' }),
      ];
      const r = countContextTokens({ messages: msgs });

      expect(r.messages).toHaveLength(3);
      expect(r.messages.map((m) => [m.index, m.role])).toEqual([
        [0, 'user'],
        [1, 'assistant'],
        [2, 'tool'],
      ]);
    });
  });

  describe('content counting', () => {
    it('counts user message content', () => {
      const r = countContextTokens({
        messages: [mkMsg({ role: 'user', content: 'hello world '.repeat(50) })],
      });
      expect(r.bySource.content).toBeGreaterThan(0);
      expect(r.messages[0].bySource.content).toBe(r.bySource.content);
      expect(r.messages[0].total).toBe(r.messages[0].bySource.content);
    });

    it('uses recorded usage.totalOutputTokens for assistant when present', () => {
      const r = countContextTokens({
        messages: [
          mkMsg({
            role: 'assistant',
            content: 'short text', // would estimate to a small count
            metadata: {
              usage: { totalOutputTokens: 5000 } as any,
            } as any,
          }),
        ],
      });
      expect(r.bySource.content).toBe(5000);
      expect(r.messages[0].bySource.content).toBe(5000);
    });

    it('prefers top-level usage.totalOutputTokens over metadata.usage', () => {
      const r = countContextTokens({
        messages: [
          mkMsg({
            role: 'assistant',
            content: 'short text',
            // dedicated field must win over the legacy metadata.usage
            usage: { totalOutputTokens: 7000 } as any,
            metadata: { usage: { totalOutputTokens: 5000 } as any } as any,
          }),
        ],
      });
      expect(r.bySource.content).toBe(7000);
      expect(r.messages[0].bySource.content).toBe(7000);
    });

    it('falls back to estimating content when usage is missing or zero', () => {
      const r = countContextTokens({
        messages: [
          mkMsg({
            role: 'assistant',
            content: 'long text that needs estimating '.repeat(100),
            metadata: { usage: { totalOutputTokens: 0 } as any } as any,
          }),
        ],
      });
      expect(r.bySource.content).toBeGreaterThan(0);
    });
  });

  describe('tool calls (assistant.tools)', () => {
    it('counts tool call payloads on assistant messages', () => {
      const r = countContextTokens({
        messages: [
          mkMsg({
            role: 'assistant',
            content: '',
            tools: [
              {
                apiName: 'searchWeb',
                arguments: '{"query": "very long query string that takes some tokens"}',
                id: 'call_abc123',
                identifier: 'search-plugin',
                type: 'default',
              },
            ] as any,
          }),
        ],
      });

      expect(r.bySource.toolCalls).toBeGreaterThan(0);
      expect(r.messages[0].bySource.toolCalls).toBe(r.bySource.toolCalls);
    });

    it('does NOT count tools on non-assistant messages', () => {
      const r = countContextTokens({
        messages: [
          mkMsg({
            role: 'user',
            content: '',
            // user messages with `tools` shouldn't be a thing, but if it slips
            // through it must not be counted toward toolCalls.
            tools: [
              { apiName: 'x', arguments: '{}', id: '1', identifier: 'p', type: 'default' },
            ] as any,
          }),
        ],
      });
      expect(r.bySource.toolCalls).toBe(0);
    });

    it('does NOT count tool calls when assistant has recorded usage (fast-path)', () => {
      // The assistant fast-path attributes recorded output tokens to `content`
      // because the recorded count already includes generated tool_calls.
      const r = countContextTokens({
        messages: [
          mkMsg({
            role: 'assistant',
            content: '',
            metadata: { usage: { totalOutputTokens: 1234 } as any } as any,
            tools: [
              {
                apiName: 'foo',
                arguments: '{"a":1}',
                id: 'c1',
                identifier: 'p',
                thoughtSignature: 'sig-skipped-on-fast-path'.repeat(20),
                type: 'default',
              },
            ] as any,
          }),
        ],
      });
      expect(r.bySource.content).toBe(1234);
      expect(r.bySource.toolCalls).toBe(0);
      expect(r.bySource.thoughtSignature).toBe(0);
    });
  });

  describe('thoughtSignature on tool calls (Gemini)', () => {
    it('counts thoughtSignature separately from toolCalls', () => {
      const r = countContextTokens({
        messages: [
          mkMsg({
            role: 'assistant',
            content: '',
            tools: [
              {
                apiName: 'searchWeb',
                arguments: '{"query":"x"}',
                id: 'call_1',
                identifier: 'p',
                thoughtSignature: 'opaque signature payload '.repeat(40),
                type: 'default',
              },
            ] as any,
          }),
        ],
      });
      expect(r.bySource.toolCalls).toBeGreaterThan(0);
      expect(r.bySource.thoughtSignature).toBeGreaterThan(0);
      // Buckets must not overlap — thoughtSignature should not be added to toolCalls
      const tcOnlyArgs = countContextTokens({
        messages: [
          mkMsg({
            role: 'assistant',
            content: '',
            tools: [
              {
                apiName: 'searchWeb',
                arguments: '{"query":"x"}',
                id: 'call_1',
                identifier: 'p',
                type: 'default',
              },
            ] as any,
          }),
        ],
      });
      expect(r.bySource.toolCalls).toBe(tcOnlyArgs.bySource.toolCalls);
    });

    it('sums thoughtSignature across multiple tool calls', () => {
      const r = countContextTokens({
        messages: [
          mkMsg({
            role: 'assistant',
            content: '',
            tools: [
              {
                apiName: 'a',
                arguments: '{}',
                id: '1',
                identifier: 'p',
                thoughtSignature: 'sig-A '.repeat(30),
                type: 'default',
              },
              {
                apiName: 'b',
                arguments: '{}',
                id: '2',
                identifier: 'p',
                thoughtSignature: 'sig-B '.repeat(30),
                type: 'default',
              },
            ] as any,
          }),
        ],
      });
      // Two distinct signatures both contribute
      expect(r.bySource.thoughtSignature).toBeGreaterThan(0);
      expect(r.messages[0].bySource.thoughtSignature).toBe(r.bySource.thoughtSignature);
    });

    it('does not count thoughtSignature when absent', () => {
      const r = countContextTokens({
        messages: [
          mkMsg({
            role: 'assistant',
            content: '',
            tools: [
              { apiName: 'a', arguments: '{}', id: '1', identifier: 'p', type: 'default' },
            ] as any,
          }),
        ],
      });
      expect(r.bySource.thoughtSignature).toBe(0);
      expect(r.messages[0].bySource.thoughtSignature).toBeUndefined();
    });
  });

  describe('reasoning trace', () => {
    it('counts ModelReasoning.content on assistant messages', () => {
      const r = countContextTokens({
        messages: [
          mkMsg({
            role: 'assistant',
            content: '',
            reasoning: { content: 'long reasoning chain '.repeat(50) },
          }),
        ],
      });
      expect(r.bySource.reasoning).toBeGreaterThan(0);
    });

    it('handles reasoning passed as a plain string', () => {
      const r = countContextTokens({
        messages: [
          mkMsg({
            role: 'assistant',
            content: '',
            reasoning: 'plain string reasoning' as any,
          }),
        ],
      });
      expect(r.bySource.reasoning).toBeGreaterThan(0);
    });

    it('skips reasoning when fast-path recorded usage is present', () => {
      const r = countContextTokens({
        messages: [
          mkMsg({
            role: 'assistant',
            content: '',
            metadata: { usage: { totalOutputTokens: 100 } as any } as any,
            reasoning: { content: 'this should not be re-counted'.repeat(50) },
          }),
        ],
      });
      expect(r.bySource.reasoning).toBe(0);
    });
  });

  describe('tool_call_id (tool messages)', () => {
    it('counts tool_call_id regardless of role', () => {
      const r = countContextTokens({
        messages: [
          mkMsg({
            role: 'tool',
            content: '{"result":"ok"}',
            tool_call_id: 'call_abc123_xyz',
          }),
        ],
      });
      expect(r.bySource.toolCallId).toBeGreaterThan(0);
      expect(r.bySource.content).toBeGreaterThan(0);
    });

    it('still counts tool_call_id on assistant fast-path', () => {
      // tool_call_id can appear on assistant in some flows; the fast-path
      // covers content/reasoning/toolCalls but tool_call_id is a separate
      // field that's always added.
      const r = countContextTokens({
        messages: [
          mkMsg({
            role: 'assistant',
            content: '',
            metadata: { usage: { totalOutputTokens: 100 } as any } as any,
            tool_call_id: 'call_xyz',
          }),
        ],
      });
      expect(r.bySource.toolCallId).toBeGreaterThan(0);
    });
  });

  describe('tool definitions (top-level tools[])', () => {
    it('counts each tool definition and exposes a per-tool breakdown', () => {
      const tools = [
        { function: { name: 'search', parameters: { type: 'object' } }, type: 'function' },
        { function: { name: 'lookup', parameters: { type: 'object' } }, type: 'function' },
      ];
      const r = countContextTokens({ messages: [], tools });

      expect(r.tools).toHaveLength(2);
      expect(r.tools.map((t) => t.name)).toEqual(['search', 'lookup']);
      expect(r.tools.every((t) => t.total > 0)).toBe(true);
      expect(r.bySource.toolDefinition).toBe(r.tools.reduce((s, t) => s + t.total, 0));
    });

    it('falls back to top-level name when function.name is absent', () => {
      const r = countContextTokens({
        messages: [],
        tools: [{ name: 'plain_tool', schema: {} }],
      });
      expect(r.tools[0].name).toBe('plain_tool');
    });

    it('uses "unknown" for tools with no resolvable name', () => {
      const r = countContextTokens({
        messages: [],
        tools: [{ description: 'nameless' }],
      });
      expect(r.tools[0].name).toBe('unknown');
    });
  });

  describe('does NOT count DB-only fields', () => {
    it('ignores plugin / pluginState / extra / chunksList / metadata extras', () => {
      const r = countContextTokens({
        messages: [
          mkMsg({
            role: 'tool',
            content: 'real_content',
            tool_call_id: 'tcid',
            // All of these are DB-only; counting them would over-estimate.
            plugin: {
              apiName: 'x',
              arguments: 'a'.repeat(5000),
              identifier: 'p',
              type: 'default',
            } as any,
            pluginState: { output: 'b'.repeat(5000), success: true } as any,
            chunksList: [{ id: 'c'.repeat(5000) }] as any,
            extra: { translate: 'd'.repeat(5000) } as any,
          }),
        ],
      });
      // Only content + tool_call_id should contribute; the other fields' bulk
      // must not show up.
      const expectedSources = new Set<string>(['content', 'toolCallId']);
      for (const k of Object.keys(r.messages[0].bySource)) {
        expect(expectedSources.has(k)).toBe(true);
      }
    });
  });

  describe('assistantGroup children (conversation-flow flattened lists)', () => {
    it('counts the real assistant blocks and inline tool results', () => {
      const r = countContextTokens({
        messages: [
          mkMsg({ role: 'user', content: 'user prompt' }),
          mkMsg({
            role: 'assistantGroup',
            content: '',
            children: [
              {
                content: 'assistant text',
                id: 'a1',
                tools: [
                  {
                    apiName: 'readFile',
                    arguments: '{"path":"/x","padding":"' + 'x'.repeat(1000) + '"}',
                    id: 't1',
                    identifier: 'fs',
                    result: { content: 'big file content '.repeat(100), id: 'result-1' },
                    type: 'default',
                  },
                ],
              },
              { content: '', id: 'a2', usage: { totalOutputTokens: 42 } },
            ],
          }),
        ],
      });

      expect(r.messages).toHaveLength(2);
      expect(r.messages[1].bySource.content).toBeGreaterThan(100);
      expect(r.messages[1].bySource.toolCalls).toBeGreaterThan(0);
      expect(r.messages[1].bySource.toolCallId).toBeGreaterThan(0);
      expect(r.rawTotal).toBeGreaterThan(150);
    });

    it('counts tool result content (tools[].result.content) on plain assistant messages', () => {
      const r = countContextTokens({
        messages: [
          mkMsg({
            role: 'assistant',
            content: 'short',
            tools: [
              {
                apiName: 'search',
                arguments: '{}',
                id: 'c1',
                identifier: 'p',
                result: { content: 'search result payload '.repeat(200) },
                type: 'default',
              } as any,
            ],
          }),
        ],
      });

      expect(r.bySource.content).toBeGreaterThan(500);
    });

    it('keeps counting result content even on the assistant usage fast-path', () => {
      const r = countContextTokens({
        messages: [
          mkMsg({
            role: 'assistant',
            content: '',
            metadata: { usage: { totalOutputTokens: 42 } as any } as any,
            tools: [
              {
                apiName: 'search',
                arguments: '{}',
                id: 'c1',
                identifier: 'p',
                result: { content: 'result payload '.repeat(100) },
                type: 'default',
              } as any,
            ],
          }),
        ],
      });

      // 42 (recorded output) + result payload tokens
      expect(r.bySource.content).toBeGreaterThan(42);
    });
  });

  describe('tasks / groupTasks containers (subagent executions)', () => {
    it('counts each task content + metadata.instruction inside a tasks container', () => {
      const r = countContextTokens({
        messages: [
          mkMsg({
            role: 'tasks',
            content: '',
            tasks: [
              mkMsg({
                role: 'task',
                content: 'result text '.repeat(50),
                metadata: { instruction: 'very long subagent instruction '.repeat(80) } as any,
              }),
              mkMsg({ role: 'task', content: 'another result '.repeat(40) }),
            ],
          }),
        ],
      });

      // Both results AND both instructions ship inside the re-emitted template
      expect(r.bySource.content).toBeGreaterThan(500);
      expect(r.messages[0].bySource.content).toBe(r.bySource.content);
      expect(r.messages[0].bySource.reasoning).toBeUndefined();
    });

    it('counts groupTasks containers the same way', () => {
      const r = countContextTokens({
        messages: [
          mkMsg({
            role: 'groupTasks',
            content: '',
            tasks: [
              mkMsg({
                role: 'task',
                content: 'group task result '.repeat(45),
                metadata: { instruction: 'group task instruction '.repeat(45) } as any,
              }),
            ],
          }),
        ],
      });

      expect(r.bySource.content).toBeGreaterThan(200);
    });

    it('counts a standalone task message (content + instruction)', () => {
      const r = countContextTokens({
        messages: [
          mkMsg({
            role: 'task',
            content: 'result '.repeat(30),
            metadata: { instruction: 'instruction '.repeat(60) } as any,
          }),
        ],
      });

      expect(r.bySource.content).toBeGreaterThan(100);

      // instruction is counted on top of content (re-emitted inside the template)
      const withInstruction = countContextTokens({
        messages: [
          mkMsg({
            role: 'task',
            content: 'same',
            metadata: { instruction: 'long instruction '.repeat(50) } as any,
          }),
        ],
      });
      const withoutInstruction = countContextTokens({
        messages: [mkMsg({ role: 'task', content: 'same' })],
      });
      expect(withInstruction.bySource.content).toBeGreaterThan(withoutInstruction.bySource.content);
    });

    it('counts task content without instruction (TaskMessage fallback)', () => {
      // TaskMessageProcessor converts to assistant with plain content when no
      // instruction is present — the result text must still count.
      const r = countContextTokens({
        messages: [mkMsg({ role: 'task', content: 'plain result '.repeat(20) })],
      });

      expect(r.bySource.content).toBeGreaterThan(0);
    });

    it('estimates the exact template text the processor emits (headings + agentName)', () => {
      const content = 'short result';
      const instruction = 'do the thing '.repeat(10);
      const r = countContextTokens({
        messages: [mkMsg({ role: 'task', content, metadata: { instruction } as any })],
      });

      // Mirror of TaskMessageProcessor output for a task without identity fields.
      const expected = estimateTokenCount(
        formatTaskMessage(DEFAULT_TEMPLATE, {
          agentName: 'Sub Agent',
          content,
          instruction,
        }),
      );
      expect(r.bySource.content).toBe(expected);
    });

    it('counts the task agentName inside the template', () => {
      const anonymous = countContextTokens({
        messages: [mkMsg({ role: 'task', content: 'r', metadata: { instruction: 'i' } as any })],
      });
      const named = countContextTokens({
        messages: [
          mkMsg({
            role: 'task',
            agentName: 'A rather long agent persona name '.repeat(10),
            content: 'r',
            metadata: { instruction: 'i' } as any,
          } as any),
        ],
      });

      expect(named.bySource.content).toBeGreaterThan(anonymous.bySource.content);
    });
  });

  describe('agentCouncil members (broadcast)', () => {
    it('counts plain assistant members with tool results', () => {
      const r = countContextTokens({
        messages: [
          mkMsg({
            role: 'agentCouncil',
            content: '',
            members: [
              mkMsg({
                role: 'assistant',
                content: 'member reply '.repeat(40),
                tools: [
                  {
                    apiName: 'search',
                    arguments: '{"q":"x"}',
                    id: 'm1',
                    identifier: 'p',
                    result: { content: 'member result payload '.repeat(60) },
                    type: 'default',
                  } as any,
                ],
              }),
            ],
          }),
        ],
      });

      expect(r.bySource.content).toBeGreaterThan(200);
      expect(r.bySource.toolCalls).toBeGreaterThan(0);
      // tool.id ships as the flattened tool message's tool_call_id
      expect(r.bySource.toolCallId).toBeGreaterThan(0);
      expect(r.bySource.content).toBeGreaterThan(150);
      expect(r.bySource.toolCalls).toBeGreaterThan(0);
      expect(r.bySource.toolCallId).toBeGreaterThan(0);
    });

    it('counts nested assistantGroup members', () => {
      const r = countContextTokens({
        messages: [
          mkMsg({
            role: 'agentCouncil',
            content: '',
            members: [
              mkMsg({
                role: 'assistantGroup',
                content: '',
                children: [
                  {
                    content: 'nested assistant text '.repeat(30),
                    id: 'n1',
                    tools: [
                      {
                        apiName: 'readFile',
                        arguments: '{}',
                        id: 'n2',
                        identifier: 'fs',
                        result: { content: 'nested result '.repeat(50) },
                        type: 'default',
                      } as any,
                    ],
                  },
                ],
              }),
            ],
          }),
        ],
      });

      expect(r.bySource.content).toBeGreaterThan(150);
      expect(r.bySource.toolCalls).toBeGreaterThan(0);
      expect(r.bySource.toolCallId).toBeGreaterThan(0);
    });
  });

  describe('aggregation', () => {
    it('sums bySource across multiple messages and tools', () => {
      const r = countContextTokens({
        messages: [
          mkMsg({ role: 'user', content: 'first '.repeat(30) }),
          mkMsg({
            role: 'assistant',
            content: 'second '.repeat(30),
            tools: [
              { apiName: 'a', arguments: '{}', id: '1', identifier: 'p', type: 'default' },
            ] as any,
            reasoning: { content: 'reason '.repeat(30) },
          }),
          mkMsg({ role: 'tool', content: '{"r":1}', tool_call_id: 'cid' }),
        ],
        tools: [
          { function: { name: 'tool_a' }, type: 'function' },
          { function: { name: 'tool_b' }, type: 'function' },
        ],
      });

      const sumOfBySource = Object.values(r.bySource).reduce((s, v) => s + v, 0);
      expect(r.rawTotal).toBe(sumOfBySource);

      const sumOfMessageTotals = r.messages.reduce((s, m) => s + m.total, 0);
      const messagesContrib = sumOfMessageTotals;
      const toolsContrib = r.bySource.toolDefinition;
      expect(r.rawTotal).toBe(messagesContrib + toolsContrib);

      expect(r.adjustedTotal).toBe(Math.ceil(r.rawTotal * DEFAULT_DRIFT_MULTIPLIER));
    });
  });
});
