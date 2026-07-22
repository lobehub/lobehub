import { describe, expect, it } from 'vitest';

import { formatFixedExecutionTargetTooltip } from '../executionTargetTooltip';

describe('formatFixedExecutionTargetTooltip', () => {
  it('matches the fixed-model tooltip structure', () => {
    expect(
      formatFixedExecutionTargetTooltip('智能', '执行环境已在助理档案中固定，聊天时不可切换。'),
    ).toBe('智能 · 执行环境已在助理档案中固定，聊天时不可切换。');
  });
});
