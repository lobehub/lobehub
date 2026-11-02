import { describe, expect, it } from 'vitest';

import { statusBadge, TASK_STATUSES } from './helpers';

describe('statusBadge', () => {
  it.each(TASK_STATUSES)('renders a badge for %s', (status) => {
    expect(statusBadge(status)).toContain(status);
    // The default branch returns the bare status, unpadded and without an icon.
    expect(statusBadge(status)).not.toBe(status);
  });
});
