import type { BuiltinToolContext } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { interactiveUIExecutor } from './index';

describe('interactive UI client executor', () => {
  it('executes through the real BaseExecutor dispatcher', async () => {
    const result = await interactiveUIExecutor.invoke(
      'renderUI',
      {
        body: [{ content: 'Example', id: 'intro', type: 'text' }],
        derived: {},
        state: {},
        fallback: 'Example',
        title: 'Example',
        version: 2,
      },
      {} as BuiltinToolContext,
    );
    expect(result.success).toBe(true);
    expect(result.state).toEqual({ status: 'ready', values: {}, version: 2 });
  });
});
