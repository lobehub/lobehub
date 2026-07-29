import { describe, expect, it } from 'vitest';

import type { ExecutionSnapshot } from '../types';
import { lintSnapshot, resolvePayloads } from './contextLint';

const base = (steps: any[]): ExecutionSnapshot =>
  ({
    operationId: 'op_test',
    startedAt: 0,
    steps,
    totalCost: 0,
    totalSteps: steps.length,
    totalTokens: 0,
    traceId: 't',
  }) as ExecutionSnapshot;

describe('resolvePayloads', () => {
  it('walks the contextEngine.output delta chain', () => {
    const snap = base([
      {
        contextEngine: { output: [{ content: 'hi', role: 'user' }] },
        stepIndex: 0,
        stepType: 'call_llm',
      },
      { stepIndex: 1, stepType: 'call_tool' },
      // CE ran but output unchanged — must reuse step 0's payload
      { contextEngine: {}, stepIndex: 2, stepType: 'call_llm' },
    ]);
    const { payloadSource, payloads } = resolvePayloads(snap);
    expect(payloadSource).toBe('ce');
    expect(payloads).toHaveLength(2);
    expect(payloads[1].messages).toEqual(payloads[0].messages);
  });

  it('falls back to legacy messages when CE fields are absent', () => {
    const snap = base([
      { messages: [{ content: 'hi', role: 'user' }], stepIndex: 0, stepType: 'call_llm' },
    ]);
    expect(resolvePayloads(snap).payloadSource).toBe('legacy');
  });
});

describe('lintSnapshot rules', () => {
  it('clean payload produces no findings and score 100', () => {
    const snap = base([
      {
        contextEngine: {
          output: [
            { content: 'You are helpful.', role: 'system' },
            { content: 'hello', role: 'user' },
          ],
        },
        stepIndex: 0,
        stepType: 'call_llm',
      },
    ]);
    const { features, findings } = lintSnapshot(snap);
    expect(findings).toHaveLength(0);
    expect(features.lintScore).toBe(100);
    expect(features.payloadMessages).toBe(2);
  });

  it('flags oversized tool results without truncation markers', () => {
    const big = 'line of output that pads the result body considerably\n'.repeat(1500);
    const snap = base([
      {
        stepIndex: 0,
        stepType: 'call_tool',
        toolsResult: [{ apiName: 'crawl', identifier: 'web', isSuccess: true, output: big }],
      },
    ]);
    const rules = lintSnapshot(snap).findings.map((f) => f.rule);
    expect(rules).toContain('oversized-tool-result');
    // uniform repeats must also trip the degenerate-repetition rule
    expect(rules).toContain('degenerate-repetition');
  });

  it('does not flag oversized results that declare truncation', () => {
    const big = 'x'.repeat(40_000) + '\n[truncated: 900 more lines]';
    const snap = base([
      {
        stepIndex: 0,
        stepType: 'call_tool',
        toolsResult: [{ apiName: 'read', identifier: 'fs', isSuccess: true, output: big }],
      },
    ]);
    const rules = lintSnapshot(snap).findings.map((f) => f.rule);
    expect(rules).not.toContain('oversized-tool-result');
  });

  it('flags oversized error results', () => {
    const stack = 'Error: ECONNRESET\n    at fetch (node:internal)\n'.repeat(80);
    const snap = base([
      {
        stepIndex: 0,
        stepType: 'call_tool',
        toolsResult: [{ apiName: 'crawl', identifier: 'web', isSuccess: false, output: stack }],
      },
    ]);
    const f = lintSnapshot(snap).findings.find((x) => x.rule === 'error-result-oversized');
    expect(f).toBeDefined();
    expect(f!.tool).toBe('web/crawl');
  });

  it('flags orphan tool results in the final payload', () => {
    const snap = base([
      {
        contextEngine: {
          output: [
            { content: 'q', role: 'user' },
            { content: 'result with no matching call', role: 'tool', tool_call_id: 'call_missing' },
          ],
        },
        stepIndex: 0,
        stepType: 'call_llm',
      },
    ]);
    const { features, findings } = lintSnapshot(snap);
    expect(features.orphanToolResults).toBe(1);
    expect(findings.some((f) => f.rule === 'orphan-tool-result')).toBe(true);
  });

  it('flags duplicated context blocks across messages', () => {
    const doc = 'A very long shared document body. '.repeat(120);
    const snap = base([
      {
        contextEngine: {
          output: [
            { content: doc, role: 'user' },
            { content: `I read it: ${doc}`, role: 'assistant' },
          ],
        },
        stepIndex: 0,
        stepType: 'call_llm',
      },
    ]);
    const { features, findings } = lintSnapshot(snap);
    expect(features.dupShare).toBeGreaterThan(0.3);
    expect(findings.some((f) => f.rule === 'duplicate-context-block')).toBe(true);
  });

  it('flags tool-def bloat from offered vs called', () => {
    const tools = Array.from({ length: 60 }, (_, i) => ({ function: { name: `t${i}` } }));
    const snap = base([
      {
        context: { payload: { tools }, phase: 'user_input' },
        stepIndex: 0,
        stepType: 'call_llm',
        toolsCalling: [{ apiName: 'a', identifier: 'x' }],
      },
    ]);
    const { features, findings } = lintSnapshot(snap);
    expect(features.toolsOffered).toBe(60);
    expect(features.toolsCalled).toBe(1);
    expect(findings.some((f) => f.rule === 'tool-def-bloat')).toBe(true);
  });
});
