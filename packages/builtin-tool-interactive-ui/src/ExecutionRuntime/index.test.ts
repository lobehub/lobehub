import { describe, expect, it } from 'vitest';

import plan from '../../examples/native-plan-comparison.json';
import { InteractiveUIExecutionRuntime } from './index';

const legacy = {
  css: '',
  fallback: 'Example',
  html: '<p>Example</p>',
  js: '',
  title: 'Example',
  version: 1,
};

describe('InteractiveUIExecutionRuntime', () => {
  it('validates a native document and initializes only declared scalar result state', async () => {
    const result = await new InteractiveUIExecutionRuntime().renderUI(plan);
    expect(result.success).toBe(true);
    expect(result.state).toEqual({
      status: 'ready',
      values: { quantity: 500, plan: 'B' },
      version: 2,
    });
    expect(result.content).toContain(plan.fallback);
    expect(result.content).toContain('autosave');
    expect(result.state).not.toHaveProperty('body');
  });

  it.each([
    null,
    {},
    legacy,
    { ...plan, js: 'fetch("https://example.com")' },
    { ...plan, version: 3 },
  ])(
    'rejects invalid and legacy executable inputs with a recoverable text result',
    async (args) => {
      const result = await new InteractiveUIExecutionRuntime().renderUI(args);
      expect(result.success).toBe(false);
      expect(result.error.type).toBe('InvalidInteractiveUI');
      expect(result.content).toContain('plain text');
      expect(result.state).toBeUndefined();
    },
  );
});
