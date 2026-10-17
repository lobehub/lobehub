import { toast } from '@lobehub/ui';
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEVICE_BOUND_TO_FIXED_AGENT } from './deviceActionError';
import { useDeviceCardMutations } from './useDeviceCardMutations';

interface MutationOptions {
  onError: (error: unknown) => void;
}

const { mutation } = vi.hoisted(() => ({
  mutation: (name: string) => vi.fn((options: MutationOptions) => ({ name, options })),
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    device: {
      removeDevice: { useMutation: mutation('removeDevice') },
      removeWorkspaceDevice: { useMutation: mutation('removeWorkspaceDevice') },
      setWorkspaceDeviceVisibility: { useMutation: mutation('setWorkspaceDeviceVisibility') },
    },
  },
}));
vi.mock('@lobehub/ui', () => ({ toast: { error: vi.fn() } }));
vi.mock('i18next', () => ({
  t: (key: string, options?: { ns?: string }) => `${options?.ns}:${key}`,
}));
vi.mock('./const', () => ({ refreshDeviceList: vi.fn() }));

const fixedAgentRefusal = Object.assign(new Error('This device is fixed to workspace agents.'), {
  data: { code: 'PRECONDITION_FAILED', errorData: { code: DEVICE_BOUND_TO_FIXED_AGENT } },
});

const failWith = (value: unknown) =>
  (value as { options: MutationOptions }).options.onError(fixedAgentRefusal);

afterEach(() => {
  vi.clearAllMocks();
});

describe('useDeviceCardMutations', () => {
  it('toasts a refused make-private instead of failing silently', () => {
    const { result } = renderHook(() => useDeviceCardMutations('workspace'));

    failWith(result.current.setVisibility);

    expect(toast.error).toHaveBeenCalledWith('setting:devices.errors.boundToFixedAgent');
  });

  it.each(['workspace', 'personal'] as const)('toasts a refused %s removal', (scope) => {
    const { result } = renderHook(() => useDeviceCardMutations(scope));

    expect(result.current.removeDevice).toMatchObject({
      name: scope === 'workspace' ? 'removeWorkspaceDevice' : 'removeDevice',
    });
    failWith(result.current.removeDevice);

    expect(toast.error).toHaveBeenCalledWith('setting:devices.errors.boundToFixedAgent');
  });
});
