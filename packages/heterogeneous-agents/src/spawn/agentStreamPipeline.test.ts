import { describe, expect, it } from 'vitest';

import { AgentStreamPipeline } from './agentStreamPipeline';

const init = (sessionId = 'cc-1') =>
  `${JSON.stringify({
    model: 'claude-sonnet-4-6',
    session_id: sessionId,
    subtype: 'init',
    type: 'system',
  })}\n`;

const ccText = (msgId: string, text: string) =>
  `${JSON.stringify({
    message: {
      content: [{ text, type: 'text' }],
      id: msgId,
      model: 'claude-sonnet-4-6',
      role: 'assistant',
    },
    type: 'assistant',
  })}\n`;

describe('AgentStreamPipeline', () => {
  it('runs JSONL → adapter → toStreamEvent and stamps operationId', async () => {
    const pipeline = new AgentStreamPipeline({
      agentType: 'claude-code',
      operationId: 'op-42',
    });

    const events = await pipeline.push(init() + ccText('msg_01', 'hello'));

    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.operationId).toBe('op-42');
    }
    expect(pipeline.sessionId).toBe('cc-1');
  });

  it('exposes the adapter session id once the init event is parsed', async () => {
    const pipeline = new AgentStreamPipeline({
      agentType: 'claude-code',
      operationId: 'op-1',
    });

    expect(pipeline.sessionId).toBeUndefined();
    await pipeline.push(init('cc-99'));
    expect(pipeline.sessionId).toBe('cc-99');
  });

  it('auto-wires the Codex file-change tracker for codex agents only', async () => {
    // claude-code → no codex tracker, file_change payloads pass through untouched
    const claude = new AgentStreamPipeline({ agentType: 'claude-code', operationId: 'op-1' });
    expect((claude as any).codexTracker).toBeUndefined();

    // codex → tracker is instantiated automatically; consumers stay agent-agnostic
    const codex = new AgentStreamPipeline({ agentType: 'codex', operationId: 'op-1' });
    expect((codex as any).codexTracker).toBeDefined();
  });

  it('drops non-JSON noise lines instead of throwing', async () => {
    const pipeline = new AgentStreamPipeline({
      agentType: 'claude-code',
      operationId: 'op-1',
    });

    const events = await pipeline.push(`not-json-line\n${init()}`);

    expect(pipeline.sessionId).toBe('cc-1');
    expect(events.length).toBeGreaterThan(0);
  });

  it('flushes adapter-buffered events on stream end', async () => {
    const pipeline = new AgentStreamPipeline({
      agentType: 'claude-code',
      operationId: 'op-1',
    });

    await pipeline.push(init());
    const flushed = await pipeline.flush();

    expect(Array.isArray(flushed)).toBe(true);
  });
});
