import { buildGoalOverviewPrompt } from '@lobechat/prompts';
import type { InitialGoalOverviewContext } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { GoalContextSyntheticInjector } from '../GoalContextSyntheticInjector';

const createContext = (messages: any[]): PipelineContext => ({
  initialState: { messages: [] },
  isAborted: false,
  messages,
  metadata: {},
});

const OVERVIEW: InitialGoalOverviewContext = {
  findings: [],
  goal: { status: 'running', title: 'Demo' },
  pendingDecisions: [],
  tasks: [{ seq: 1, status: 'active', title: 'Only task' }],
};
// The injector owns prompt composition — callers pass structured data only.
const OVERVIEW_PROMPT = buildGoalOverviewPrompt(OVERVIEW);

describe('GoalContextSyntheticInjector', () => {
  it('injects a getGoalContext tool pair right after the last user message', async () => {
    const provider = new GoalContextSyntheticInjector({ enabled: true, overview: OVERVIEW });
    const result = await provider.process(
      createContext([
        { content: 'sys', role: 'system' },
        { content: 'earlier question', role: 'user' },
        { content: 'earlier answer', role: 'assistant' },
        { content: '现在进展如何？', role: 'user' },
      ]),
    );

    expect(result.messages).toHaveLength(6);
    const [assistant, tool] = result.messages.slice(4);
    expect(assistant.role).toBe('assistant');
    expect(assistant.tool_calls?.[0]?.function?.name).toBe('getGoalContext');
    expect(tool.role).toBe('tool');
    expect(tool.tool_call_id).toBe(assistant.tool_calls?.[0]?.id);
    expect(tool.content).toBe(OVERVIEW_PROMPT);
    expect(tool.content).toContain('<goal_overview>');
    // the user message itself stays untouched
    expect(result.messages[3].content).toBe('现在进展如何？');
  });

  it('injects exactly one fresh pair per request across a multi-turn history', async () => {
    // The pair is injected per-request into the pipeline and never persisted,
    // so a long conversation still carries exactly one pair — after the LAST
    // user message — no matter how many earlier turns exist.
    const provider = new GoalContextSyntheticInjector({ enabled: true, overview: OVERVIEW });
    const result = await provider.process(
      createContext([
        { content: 'sys', role: 'system' },
        { content: '第一轮：进展如何？', role: 'user' },
        { content: '第一轮回答', role: 'assistant' },
        { content: '第二轮：卡在哪里？', role: 'user' },
        { content: '第二轮回答', role: 'assistant' },
        { content: '第三轮：接下来做什么？', role: 'user' },
      ]),
    );

    const pairs = result.messages.filter(
      (m: any) => m.tool_calls?.[0]?.function?.name === 'getGoalContext',
    );
    expect(pairs).toHaveLength(1);
    expect(result.messages).toHaveLength(8);
    // pair sits after the LAST user message, earlier turns untouched
    expect(result.messages[5].content).toBe('第三轮：接下来做什么？');
    expect(result.messages[6].tool_calls?.[0]?.function?.name).toBe('getGoalContext');
    expect(result.messages[7].role).toBe('tool');
    expect(result.messages[2].content).toBe('第一轮回答');
  });

  it('keeps a real tool chain intact when the current turn already ran tools', async () => {
    // Second model call of a turn that ran a real tool (e.g. web search):
    // [user][real assistant tool_call][real tool result]. The synthetic pair
    // lands right after the user message; both tool exchanges stay adjacent
    // and self-contained, so provider-side tool ordering remains valid.
    const provider = new GoalContextSyntheticInjector({ enabled: true, overview: OVERVIEW });
    const result = await provider.process(
      createContext([
        { content: 'sys', role: 'system' },
        { content: '搜一下再回答我进展', role: 'user' },
        {
          content: '',
          role: 'assistant',
          tool_calls: [
            {
              function: { arguments: '{"query":"x"}', name: 'lobe-web-browsing____search' },
              id: 'call_real',
              type: 'function',
            },
          ],
        },
        { content: '[search results]', role: 'tool', tool_call_id: 'call_real' },
      ]),
    );

    expect(result.messages.map((m: any) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'assistant',
      'tool',
    ]);
    // synthetic pair directly after the user message…
    expect(result.messages[2].tool_calls?.[0]?.function?.name).toBe('getGoalContext');
    expect(result.messages[3].tool_call_id).toBe(result.messages[2].tool_calls?.[0]?.id);
    // …and the real chain untouched and still adjacent
    expect(result.messages[4].tool_calls?.[0]?.id).toBe('call_real');
    expect(result.messages[5].tool_call_id).toBe('call_real');
  });

  it('does nothing when disabled, without overview, or with no user message', async () => {
    const messages = [{ content: 'sys', role: 'system' }];

    for (const provider of [
      new GoalContextSyntheticInjector({ enabled: false, overview: OVERVIEW }),
      new GoalContextSyntheticInjector({ enabled: true }),
      new GoalContextSyntheticInjector({ enabled: true, overview: OVERVIEW }),
    ]) {
      const result = await provider.process(createContext([...messages]));
      expect(result.messages).toHaveLength(1);
    }
  });
});
