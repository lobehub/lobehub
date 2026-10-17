import { describe, expect, it } from 'vitest';

import { batchContainerStatus } from './experimentStatus';

describe('batchContainerStatus', () => {
  it('reads an open batch from its rollout phase, not its never-moving node', () => {
    expect(batchContainerStatus('probe')).toBe('active');
    expect(batchContainerStatus('mass')).toBe('active');
    expect(batchContainerStatus('pattern_break')).toBe('waiting');
    expect(batchContainerStatus('done')).toBe('resolved');
  });

  it('leaves a batch with no rollout state to its node', () => {
    expect(batchContainerStatus(undefined)).toBeUndefined();
  });
});
