import type { ToolRunResult } from '@lobechat/agent-runtime';
import { describe, expect, it, vi } from 'vitest';

import { EVAL_TOOL_GATE_HOOK_ID } from '../constants';
import { createEvalToolGateHook, EVAL_TOOL_BLOCKED_ERROR } from '../evalToolGateHook';

const call = (identifier: string, apiName = 'search') => {
  const mock = vi.fn<(result: ToolRunResult) => boolean>(() => true);
  const event = {
    apiName,
    args: {},
    callIndex: 1,
    identifier,
    mock,
    operationId: 'op_1',
    stepIndex: 0,
  };
  return { event, mock };
};

const run = async (allowed: string[], identifier: string, apiName?: string) => {
  const hook = createEvalToolGateHook(allowed);
  const { event, mock } = call(identifier, apiName);
  await hook.handler!(event as any);
  return mock;
};

describe('createEvalToolGateHook', () => {
  it('is a beforeToolCall hook with a stable id', () => {
    const hook = createEvalToolGateHook(['notion']);
    expect(hook.type).toBe('beforeToolCall');
    expect(hook.id).toBe(EVAL_TOOL_GATE_HOOK_ID);
  });

  it('lets a declared tool through untouched', async () => {
    const mock = await run(['notion', 'lobe-activator'], 'notion');
    expect(mock).not.toHaveBeenCalled();
  });

  it("refuses a tool the case did not declare with the harness's error", async () => {
    const mock = await run(['notion'], 'gmail', 'gmail_search_emails');
    expect(mock).toHaveBeenCalledTimes(1);
    const result = mock.mock.calls[0]?.[0];
    expect(result?.success).toBe(false);
    expect(JSON.parse(String(result?.content))).toEqual({
      error: EVAL_TOOL_BLOCKED_ERROR,
      message: "gmail is not part of this case's environment.",
      requested: 'gmail/gmail_search_emails',
    });
  });

  it('refuses everything when the case declares no tools', async () => {
    const mock = await run([], 'lobe-local-system', 'runCommand');
    expect(mock).toHaveBeenCalledTimes(1);
  });
});
