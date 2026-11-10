// @vitest-environment node
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

import { planCompositionObserver } from './compositionObserver';

const instrument = (code: string) => {
  const plan = planCompositionObserver(code, 'Component.tsx');
  let output = code;
  for (const edit of [...plan.edits].sort((a, b) => b.start - a.start))
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  // The controlled test's import is replaced by its injected implementation.
  output = output.replace(/import[^;]+;/, '').replace('export const ', 'const ');
  return { output, plan };
};
describe('composition observer behavior', () => {
  it('preserves return identity, argument evaluation order, exceptions and top-level calls', () => {
    const { output, plan } = instrument(
      '"use client";import {cx} from "@lobehub/ui"; const value = cx(next(), cx("b"));',
    );
    expect(output.startsWith('"use client";')).toBe(true);
    expect(plan.calls).toHaveLength(2);
    const events: unknown[] = [];
    const context = {
      cx: (...args: unknown[]) => {
        events.push(args);
        return args.join(' ');
      },
      next: () => {
        events.push('next');
        return 'a';
      },
    };
    const result = vm.runInNewContext(
      `${output}\n({value, trace:__styleVerificationCompositions})`,
      context,
    );
    expect(events).toEqual(['next', ['b'], ['a', 'b']]);
    expect(result.value).toBe('a b');
    expect(result.trace.records).toHaveLength(2);
    const error = new Error('original');
    expect(() =>
      vm.runInNewContext(output, {
        ...context,
        cx: () => {
          throw error;
        },
      }),
    ).toThrow(error);
  });
  it('resolves aliases and does not instrument shadowed parameters or local functions', () => {
    const { plan } = instrument(
      'import {cx as merge} from "@lobehub/ui"; const value=merge("a"); function f(merge){return merge("b")}',
    );
    expect(plan.calls).toHaveLength(1);
    expect(plan.calls[0].symbol).toBe('merge');
  });
  it('never inspects non-string arguments or changes an unsupported return object', () => {
    const { output } = instrument('import {cx} from "@lobehub/ui";const value=cx(argument);');
    const argument = new Proxy(
      {},
      {
        get: () => {
          throw new Error('argument read');
        },
      },
    );
    const returned = {};
    const result = vm.runInNewContext(
      `${output}\n({value,trace:__styleVerificationCompositions})`,
      { cx: () => returned, argument },
    );
    expect(result.value).toBe(returned);
    expect(result.trace.records).toHaveLength(0);
    expect(result.trace.gaps).toEqual(['COMPOSITION_ARGUMENT_UNSUPPORTED']);
  });
  it('records unobserved aliases, unsupported syntax and budget exhaustion as gaps', () => {
    const { plan } = instrument('import {cx} from "@lobehub/ui";const alias=cx;cx?.("a");');
    expect(plan.gaps).toContain('COMPOSITION_FUNCTION_REFERENCE_UNOBSERVED');
    expect(plan.gaps).toContain('COMPOSITION_CALL_SYNTAX_UNSUPPORTED');
    const { output } = instrument(
      'import {cx} from "@lobehub/ui";for(let i=0;i<514;i++)cx(String(i));',
    );
    const trace = vm.runInNewContext(`${output}\n__styleVerificationCompositions`, {
      cx: (s: string) => s,
    });
    expect(trace.records).toHaveLength(512);
    expect(trace.gaps).toContain('COMPOSITION_TRACE_BUDGET_EXCEEDED');
  });
});
