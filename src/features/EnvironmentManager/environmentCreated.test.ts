import { describe, expect, it, vi } from 'vitest';

import { openCreatedEnvironment } from './environmentCreated';

describe('openCreatedEnvironment', () => {
  it('opens the new environment and starts its default copy, asking nothing', () => {
    const select = vi.fn();
    const buildInstance = vi.fn().mockResolvedValue(undefined);

    openCreatedEnvironment(
      { defaultInstance: { id: 'inst-default' } as never, id: 'env-1' },
      { buildInstance, select },
    );

    expect(select).toHaveBeenCalledWith('env-1');
    expect(buildInstance).toHaveBeenCalledWith('inst-default');
  });

  it('opens the environment and builds nothing when the server sent no default copy', () => {
    const select = vi.fn();
    const buildInstance = vi.fn().mockResolvedValue(undefined);

    openCreatedEnvironment({ defaultInstance: undefined, id: 'env-1' }, { buildInstance, select });

    expect(select).toHaveBeenCalledWith('env-1');
    expect(buildInstance).not.toHaveBeenCalled();
  });
});
