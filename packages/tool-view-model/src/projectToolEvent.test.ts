import { describe, expect, it } from 'vitest';

import { projectToolEndResult } from './projectToolEvent';

const toolEndData = (result: Record<string, unknown>, identifier = 'lobe-web-browsing') => ({
  executionTime: 12,
  isSuccess: true,
  payload: { parentMessageId: 'msg-1', toolCalling: { apiName: 'crawlSinglePage', identifier } },
  phase: 'tool_execution',
  result,
});

describe('projectToolEndResult', () => {
  it('drops the result body', () => {
    const projected = projectToolEndResult(
      toolEndData({ content: 'RAW BODY', success: true }),
    ) as any;

    expect('content' in projected.result).toBe(false);
    expect(projected.result.success).toBe(true);
  });

  it('keeps the fields the executor hooks and the Work refresh read', () => {
    const projected = projectToolEndResult(
      toolEndData({ content: 'RAW BODY', success: false, workRegistration: { type: 'skill' } }),
    ) as any;

    expect(projected.result.workRegistration).toEqual({ type: 'skill' });
    expect(projected.result.success).toBe(false);
    expect(projected.isSuccess).toBe(true);
    expect(projected.executionTime).toBe(12);
    expect(projected.payload).toEqual({
      parentMessageId: 'msg-1',
      toolCalling: { apiName: 'crawlSinglePage', identifier: 'lobe-web-browsing' },
    });
  });

  it('projects the state through the same projector the read path uses', () => {
    const projected = projectToolEndResult(
      toolEndData({
        content: 'RAW BODY',
        state: { results: [{ crawler: 'naive', data: { content: 'x'.repeat(5000) }, url: 'u' }] },
        success: true,
      }),
    ) as any;

    const [entry] = projected.result.state.results;
    expect(entry.data.content.length).toBeLessThan(5000);
    expect(entry.data.length).toBe(5000);
  });

  it('still drops the body for a tool with no projector', () => {
    const projected = projectToolEndResult(
      toolEndData({ content: 'RAW BODY', state: { anything: 1 } }, 'some-mcp-plugin'),
    ) as any;

    expect('content' in projected.result).toBe(false);
    expect(projected.result.state).toEqual({ anything: 1 });
  });

  it('leaves data it does not recognize alone', () => {
    expect(projectToolEndResult(undefined)).toBeUndefined();
    expect(projectToolEndResult({ result: 'not-an-object' })).toEqual({ result: 'not-an-object' });

    const bodiless = { payload: {}, result: { success: true } };
    expect(projectToolEndResult(bodiless)).toBe(bodiless);
  });
});
