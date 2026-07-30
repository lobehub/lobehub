import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { PlaceholderMessageFilterProcessor } from '../PlaceholderMessageFilter';

describe('PlaceholderMessageFilterProcessor', () => {
  const createContext = (messages: any[]): PipelineContext => ({
    initialState: {
      messages: [],
      model: 'test-model',
      provider: 'test-provider',
    },
    isAborted: false,
    messages,
    metadata: {},
  });

  const processor = new PlaceholderMessageFilterProcessor();

  it('should remove failed assistant placeholders that carry an error', async () => {
    // Regression: persisted "..." rows from failed generations poisoned the
    // topic — replayed at the payload tail they trigger the Claude 4.6+
    // assistant-prefill 400 on every subsequent send (LOBE-12572).
    const context = createContext([
      { content: 'hi', id: 'u1', role: 'user' },
      { content: '...', error: { type: 'CapabilityNotSupported' }, id: 'a1', role: 'assistant' },
      { content: 'retry', id: 'u2', role: 'user' },
    ]);

    const result = await processor.process(context);

    expect(result.messages.map((m) => m.id)).toEqual(['u1', 'u2']);
    expect(result.metadata.placeholderMessageFilter).toEqual({ removedCount: 1 });
  });

  it('should remove orphaned placeholders that never got an error written', async () => {
    // A crashed/abandoned run leaves the placeholder row with error = null.
    const context = createContext([
      { content: 'hi', id: 'u1', role: 'user' },
      { content: '...', error: null, id: 'a1', role: 'assistant' },
      { content: '', id: 'a2', role: 'assistant' },
      { content: null, id: 'a3', role: 'assistant' },
    ]);

    const result = await processor.process(context);

    expect(result.messages.map((m) => m.id)).toEqual(['u1']);
    expect(result.metadata.placeholderMessageFilter).toEqual({ removedCount: 3 });
  });

  it('should keep assistant messages with real content, even when errored', async () => {
    const context = createContext([
      {
        content: 'partial answer before failing',
        error: { type: 'Timeout' },
        id: 'a1',
        role: 'assistant',
      },
      { content: 'a full answer', id: 'a2', role: 'assistant' },
    ]);

    const result = await processor.process(context);

    expect(result.messages).toHaveLength(2);
    expect(result.metadata.placeholderMessageFilter).toEqual({ removedCount: 0 });
  });

  it('should keep placeholder-content messages that carry tool calls', async () => {
    const context = createContext([
      { content: '...', id: 'a1', role: 'assistant', tools: [{ id: 'tool_1' }] },
      {
        content: '...',
        id: 'a2',
        role: 'assistant',
        tool_calls: [{ id: 'call_1', type: 'function' }],
      },
    ]);

    const result = await processor.process(context);

    expect(result.messages).toHaveLength(2);
  });

  it('should keep empty-content messages whose tool_calls field exists but is empty', async () => {
    // Pipeline contract: an assistant row that went through the tool pipeline
    // keeps its (possibly empty) tool_calls array — presence, not length,
    // marks it as non-placeholder (see contextEngineering "empty tool calls").
    const context = createContext([
      { content: '', id: 'a1', role: 'assistant', tool_calls: [] },
      { content: '', id: 'a2', role: 'assistant', tools: [] },
    ]);

    const result = await processor.process(context);

    expect(result.messages).toHaveLength(2);
    expect(result.metadata.placeholderMessageFilter).toEqual({ removedCount: 0 });
  });

  it('should keep empty-content messages that carry multimodal attachments', async () => {
    const context = createContext([
      {
        content: '',
        id: 'a1',
        imageList: [{ id: 'img1', url: 'https://x/img.png' }],
        role: 'assistant',
      },
      { content: '', fileList: [{ id: 'f1' }], id: 'a2', role: 'assistant' },
      { audioList: [{ id: 'au1' }], content: '', id: 'a3', role: 'assistant' },
      { content: '', id: 'a4', role: 'assistant', videoList: [{ id: 'v1' }] },
    ]);

    const result = await processor.process(context);

    expect(result.messages).toHaveLength(4);
    expect(result.metadata.placeholderMessageFilter).toEqual({ removedCount: 0 });
  });

  it('should prune placeholder residue nested inside containers and drop emptied ones', async () => {
    // A placeholder-only container would otherwise consume one history-
    // truncation slot and then vanish at the flatten phase.
    const context = createContext([
      { content: 'hi', id: 'u1', role: 'user' },
      { content: '', id: 'g1', role: 'tasks', tasks: [{ content: '...', id: 'c1' }] },
      {
        children: [
          { content: '...', id: 'c2', role: 'assistant' },
          { content: 'real reply', id: 'c3', role: 'assistant' },
          { content: '', id: 'c4', role: 'tool', tool_call_id: 'call_1' },
        ],
        content: '',
        id: 'g2',
        role: 'assistantGroup',
      },
    ]);

    const result = await processor.process(context);

    expect(result.messages.map((m) => m.id)).toEqual(['u1', 'g2']);
    // Empty-content tool child stays; only the "..." assistant child is pruned.
    expect(result.messages[1].children.map((c: any) => c.id)).toEqual(['c3', 'c4']);
    // c1 + dropped g1 container + c2
    expect(result.metadata.placeholderMessageFilter).toEqual({ removedCount: 3 });
  });

  it('should prune council members recursively and drop placeholder-only councils', async () => {
    // agentCouncil members can themselves be assistantGroup containers — an
    // all-residue council must vanish before history truncation counts it.
    const context = createContext([
      { content: 'hi', id: 'u1', role: 'user' },
      {
        content: '',
        id: 'council-1',
        members: [
          { content: '...', id: 'm1', role: 'assistant' },
          {
            children: [{ content: '...', id: 'm2c1', role: 'assistant' }],
            content: '',
            id: 'm2',
            role: 'assistantGroup',
          },
        ],
        role: 'agentCouncil',
      },
    ]);

    const result = await processor.process(context);

    expect(result.messages.map((m) => m.id)).toEqual(['u1']);
  });

  it('should accumulate removedCount across two pipeline passes', async () => {
    // The processor runs twice per pipeline (top-level + post-flatten for
    // residue expanded out of group children) — counts must not reset.
    const first = await processor.process(
      createContext([{ content: '...', id: 'a1', role: 'assistant' }]),
    );
    const second = await new PlaceholderMessageFilterProcessor().process({
      ...first,
      messages: [{ content: '...', id: 'a2', role: 'assistant' }],
    });

    expect(second.metadata.placeholderMessageFilter).toEqual({ removedCount: 2 });
  });

  it('should keep placeholder-content messages that carry reasoning text', async () => {
    const context = createContext([
      { content: '...', id: 'a1', reasoning: { content: 'thought hard' }, role: 'assistant' },
    ]);

    const result = await processor.process(context);

    expect(result.messages).toHaveLength(1);
  });

  it('should keep hidden reasoning-only turns (signature / responseItems, no text)', async () => {
    // A Responses/thinking run can finish with no visible assistant text but
    // persisted encrypted reasoning state the next request must replay.
    const context = createContext([
      { content: '', id: 'a1', reasoning: { signature: 'enc-sig' }, role: 'assistant' },
      {
        content: '...',
        id: 'a2',
        reasoning: { responseItems: [{ id: 'rs_1', type: 'reasoning' }] },
        role: 'assistant',
      },
    ]);

    const result = await processor.process(context);

    expect(result.messages).toHaveLength(2);
    expect(result.metadata.placeholderMessageFilter).toEqual({ removedCount: 0 });
  });

  it('should keep multimodal array content and non-assistant messages untouched', async () => {
    const context = createContext([
      { content: [{ text: 'img', type: 'text' }], id: 'a1', role: 'assistant' },
      { content: '...', id: 'u1', role: 'user' },
      { content: '', id: 't1', role: 'tool', tool_call_id: 'call_1' },
    ]);

    const result = await processor.process(context);

    expect(result.messages).toHaveLength(3);
  });

  it('should keep intentionally added assistant messages (manual prefill)', async () => {
    // The "add an assistant message" input-menu feature persists a plain
    // assistant row with user-typed content and no error — must never filter.
    const context = createContext([
      { content: 'hi', id: 'u1', role: 'user' },
      { content: 'Sure! Here is my draft:', id: 'a1', role: 'assistant' },
    ]);

    const result = await processor.process(context);

    expect(result.messages).toHaveLength(2);
  });
});
