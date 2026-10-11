import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCreateCopy } from '../useCreateCopy';

const service = vi.hoisted(() => ({
  createInstanceForEnvironment: vi.fn(),
  startInstanceBuild: vi.fn(),
}));

vi.mock('@/services/sandboxStorage', () => ({ sandboxStorageService: service }));

const created = {
  createdAt: new Date('2026-10-01T00:05:00Z'),
  environmentId: 'env',
  id: 'env-2',
  name: 'env-2',
  workingDirectory: 'env-2',
};

interface Listed {
  instances: Record<string, unknown>[];
}

const listed = (environmentId: string, id: string) => ({ environmentId, id });

const setup = (previous: Listed = { instances: [] }) => {
  const onChange = vi.fn().mockResolvedValue(undefined);
  const onBuildError = vi.fn();
  const onCreateError = vi.fn();
  let cache = previous;
  const refreshInstances = vi.fn(async (update?: (value: Listed) => Listed) => {
    if (update) cache = update(cache);
  });

  const { result } = renderHook(() =>
    useCreateCopy({
      onBuildError,
      onChange,
      refreshInstances: refreshInstances as unknown as Parameters<
        typeof useCreateCopy
      >[0]['refreshInstances'],
      topicId: 'topic-1',
    }),
  );

  return { cache: () => cache, onBuildError, onChange, onCreateError, refreshInstances, result };
};

beforeEach(() => {
  vi.clearAllMocks();
  service.createInstanceForEnvironment.mockResolvedValue(created);
  service.startInstanceBuild.mockResolvedValue({ buildId: 'build-1' });
});

describe('useCreateCopy', () => {
  it('creates the copy, binds this conversation to it, then starts its build', async () => {
    const { onChange, onCreateError, result } = setup();

    await act(() => result.current.create('env', onCreateError));

    expect(service.createInstanceForEnvironment).toHaveBeenCalledWith({ environmentId: 'env' });
    expect(onChange).toHaveBeenCalledWith({ instanceId: 'env-2', mode: 'persistent' });
    expect(service.startInstanceBuild).toHaveBeenCalledWith({ id: 'env-2', topicId: 'topic-1' });

    const order = [
      service.createInstanceForEnvironment.mock.invocationCallOrder[0],
      onChange.mock.invocationCallOrder[0],
      service.startInstanceBuild.mock.invocationCallOrder[0],
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(onCreateError).not.toHaveBeenCalled();
  });

  it('lists the new copy as building before the build starts', async () => {
    const { cache, onCreateError, result } = setup({
      instances: [listed('env', 'env-1')],
    });

    await act(() => result.current.create('env', onCreateError));

    expect(cache().instances).toHaveLength(2);
    expect(cache().instances[1]).toMatchObject({
      environmentId: 'env',
      id: 'env-2',
      inUse: false,
      // A sibling exists, so the new one is not the default.
      isDefault: false,
      status: 'pending',
    });
  });

  it('marks a lazily created copy — the only one of its environment — as the default', async () => {
    const { cache, onCreateError, result } = setup({
      instances: [listed('other', 'other-1')],
    });

    await act(() => result.current.create('env', onCreateError));

    expect(cache().instances[1]).toMatchObject({ id: 'env-2', isDefault: true });
  });

  it('binds nothing and reports when the copy cannot be created', async () => {
    const failure = new Error('NOT_FOUND');
    service.createInstanceForEnvironment.mockRejectedValue(failure);
    const { onChange, onCreateError, result } = setup();

    await act(() => result.current.create('env', onCreateError));

    expect(onCreateError).toHaveBeenCalledWith(failure);
    expect(onChange).not.toHaveBeenCalled();
    expect(service.startInstanceBuild).not.toHaveBeenCalled();
  });

  it('keeps the copy bound when only its build fails to start', async () => {
    const failure = new Error('build');
    service.startInstanceBuild.mockRejectedValue(failure);
    const { onBuildError, onChange, onCreateError, result } = setup();

    await act(() => result.current.create('env', onCreateError));
    await act(async () => {});

    expect(onChange).toHaveBeenCalledWith({ instanceId: 'env-2', mode: 'persistent' });
    expect(onBuildError).toHaveBeenCalledWith(failure);
    expect(onCreateError).not.toHaveBeenCalled();
  });

  it('marks the environment as preparing until the copy is bound', async () => {
    let resolveCreate: (value: typeof created) => void = () => {};
    service.createInstanceForEnvironment.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );
    const { onCreateError, result } = setup();

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.create('env', onCreateError);
    });
    expect(result.current.isPreparing('env')).toBe(true);

    await act(async () => {
      resolveCreate(created);
      await pending;
    });
    expect(result.current.isPreparing('env')).toBe(false);
  });
});
