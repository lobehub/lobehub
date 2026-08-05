import { describe, expect, it } from 'vitest';

import { formatLockedControlTooltip } from './lockedControlTooltip';

describe('formatLockedControlTooltip', () => {
  it('joins the current value and the lock reason', () => {
    expect(formatLockedControlTooltip('智能', '执行环境已在助理档案中固定，聊天时不可切换。')).toBe(
      '智能 · 执行环境已在助理档案中固定，聊天时不可切换。',
    );
  });
});
