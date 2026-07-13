import { estimateTokenCount } from 'tokenx';
import { describe, expect, it } from 'vitest';

import type { UIChatMessage } from '@/types/index';

import { MessagesEngine } from '../MessagesEngine';
import type { MessagesEngineParams } from '../types';

/**
 * Golden regression tests for the assembled LLM payload.
 *
 * Unlike the behavior tests in MessagesEngine.test.ts, these pin the *entire* output
 * payload for fixed scenarios via snapshots, plus hard budget/structure invariants.
 * A processor change that grows the system prompt, drops a tool linkage, or reorders
 * messages shows up here as a reviewable snapshot diff instead of a production
 * token-bill surprise.
 *
 * Budgets are intentionally generous ceilings, not targets — bump them consciously in
 * the same PR that grows the payload, with the cost called out in review.
 */

const at = 1_700_000_000_000; // fixed timestamps keep snapshots stable

// object (not Partial<UIChatMessage>) so fixtures can carry OpenAI-shape fields like
// tool_calls that UIChatMessage doesn't declare — same as the inline casts in MessagesEngine.test.ts
const msg = (partial: object): UIChatMessage =>
  ({ createdAt: at, updatedAt: at, ...partial }) as UIChatMessage;

const payloadTokens = (messages: Array<{ content?: unknown; tool_calls?: unknown }>) =>
  messages.reduce(
    (sum, m) =>
      sum +
      estimateTokenCount(
        (typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '')) +
          (m.tool_calls ? JSON.stringify(m.tool_calls) : ''),
      ),
    0,
  );

/** Structure invariants every assembled payload must satisfy. */
const expectWellFormed = (messages: any[]) => {
  // single leading system message (when present)
  const systemIndexes = messages.flatMap((m, i) => (m.role === 'system' ? [i] : []));
  expect(systemIndexes.length).toBeLessThanOrEqual(1);
  if (systemIndexes.length === 1) expect(systemIndexes[0]).toBe(0);

  // every tool message links to a preceding assistant tool_call (no orphans)
  const seenCallIds = new Set<string>();
  for (const m of messages) {
    if (m.role === 'assistant') {
      for (const c of m.tool_calls ?? []) seenCallIds.add(c.id);
    }
    if (m.role === 'tool') {
      expect(m.tool_call_id, 'tool message must carry tool_call_id').toBeTruthy();
      expect(seenCallIds.has(m.tool_call_id), `orphan tool result ${m.tool_call_id}`).toBe(true);
    }
  }

  // no empty non-assistant messages (dead weight the model cannot use)
  for (const m of messages) {
    if (m.role === 'user' || m.role === 'tool') {
      expect(String(m.content ?? '').length, `${m.role} message must not be empty`).toBeGreaterThan(
        0,
      );
    }
  }
};

describe('MessagesEngine golden payloads', () => {
  it('plain chat: system role + short history', async () => {
    const params: MessagesEngineParams = {
      enableSystemDate: false,
      messages: [
        msg({ content: '推荐一个 mac 上的 redis 客户端', id: 'u1', role: 'user' }),
        msg({ content: '可以试试 Medis。', id: 'a1', role: 'assistant' }),
        msg({ content: '开源的吗？', id: 'u2', role: 'user' }),
      ],
      model: 'gpt-4',
      provider: 'openai',
      systemRole: 'You are LobeHub assistant. Answer concisely in the user language.',
    };

    const { messages } = await new MessagesEngine(params).process();

    expectWellFormed(messages);
    expect(messages).toMatchSnapshot();
    expect(payloadTokens(messages)).toBeLessThan(200);
  });

  it('tool round-trip: assistant tool_calls + tool result survive assembly intact', async () => {
    const params: MessagesEngineParams = {
      enableSystemDate: false,
      messages: [
        msg({ content: '查一下项目里有多少 TODO', id: 'u1', role: 'user' }),
        msg({
          content: '',
          id: 'a1',
          role: 'assistant',
          tool_calls: [
            {
              function: {
                arguments: '{"pattern":"TODO","path":"src"}',
                name: 'lobe-local-system____grepContent',
              },
              id: 'call_1',
              type: 'function',
            },
          ],
        }),
        msg({
          content:
            'Found 3 matches:\nsrc/a.ts:12: // TODO refactor\nsrc/b.ts:3: // TODO test\nsrc/c.ts:8: // TODO doc',
          id: 't1',
          role: 'tool',
          tool_call_id: 'call_1',
        }),
        msg({ content: '帮我列成表格', id: 'u2', role: 'user' }),
      ],
      model: 'gpt-4',
      provider: 'openai',
      systemRole: 'You are LobeHub assistant.',
    };

    const { messages } = await new MessagesEngine(params).process();

    expectWellFormed(messages);
    // the tool linkage must survive assembly — losing it silently breaks the next turn
    expect(messages.some((m: any) => m.role === 'tool' && m.tool_call_id === 'call_1')).toBe(true);
    expect(messages.some((m: any) => m.tool_calls?.some((c: any) => c.id === 'call_1'))).toBe(true);
    expect(messages).toMatchSnapshot();
  });

  it('system prompt assembly stays inside its token budget', async () => {
    const params: MessagesEngineParams = {
      enableSystemDate: false,
      knowledge: {
        fileContents: [
          { content: 'Redis is an in-memory data store.', fileId: 'f1', filename: 'redis.md' },
        ],
        knowledgeBases: [{ id: 'kb1', name: 'Docs' }],
      },
      messages: [msg({ content: 'redis 怎么做持久化？', id: 'u1', role: 'user' })],
      model: 'gpt-4',
      provider: 'openai',
      systemRole: 'You are LobeHub assistant.',
    };

    const { messages } = await new MessagesEngine(params).process();
    const system = messages.find((m: any) => m.role === 'system');

    expectWellFormed(messages);
    expect(system).toBeDefined();
    // Fixture system prompt (role + knowledge scaffold) must stay small. The production
    // median system prompt is already ~13k tokens / 32% of the payload — this guard is
    // about catching *unreviewed template growth* at the source.
    expect(estimateTokenCount(String(system!.content))).toBeLessThan(600);
    expect(messages).toMatchSnapshot();
  });

  it('history truncation: historyCount actually bounds the payload', async () => {
    const history: UIChatMessage[] = [];
    for (let i = 0; i < 20; i++) {
      history.push(
        msg({ content: `question ${i}`, id: `u${i}`, role: 'user' }),
        msg({ content: `answer ${i}`, id: `a${i}`, role: 'assistant' }),
      );
    }
    history.push(msg({ content: 'final question', id: 'u-final', role: 'user' }));

    const params: MessagesEngineParams = {
      enableHistoryCount: true,
      enableSystemDate: false,
      historyCount: 4,
      messages: history,
      model: 'gpt-4',
      provider: 'openai',
    };

    const { messages } = await new MessagesEngine(params).process();

    expectWellFormed(messages);
    const nonSystem = messages.filter((m: any) => m.role !== 'system');
    expect(nonSystem.length).toBeLessThanOrEqual(5);
    expect(nonSystem.at(-1)?.content).toBe('final question');
    expect(messages).toMatchSnapshot();
  });
});
