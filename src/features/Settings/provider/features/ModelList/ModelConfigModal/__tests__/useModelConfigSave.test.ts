import { type FormInstance } from '@lobehub/ui/base-ui/form';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useModelConfigSave } from '../useModelConfigSave';

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  error: vi.fn(),
  updateAiModelsConfig: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  toast: { error: mocks.error },
  useModalContext: () => ({ close: mocks.close }),
}));

vi.mock('@/store/aiInfra', () => ({
  useAiInfraStore: (
    selector: (s: {
      activeAiProvider: string;
      updateAiModelsConfig: typeof mocks.updateAiModelsConfig;
    }) => unknown,
  ) =>
    selector({
      activeAiProvider: 'openai',
      updateAiModelsConfig: mocks.updateAiModelsConfig,
    }),
}));

const formValues = { config: null, displayName: 'GPT', id: 'gpt-4o' };
const formRef = { current: { getValues: () => formValues } as FormInstance };

describe('useModelConfigSave', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateAiModelsConfig.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('tracks a pending save and closes the modal on success', async () => {
    let resolveSave!: () => void;
    mocks.updateAiModelsConfig.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveSave = resolve;
      }),
    );
    const { result } = renderHook(() => useModelConfigSave({ formRef, id: 'gpt-4o' }));
    let save!: Promise<void>;
    act(() => {
      save = result.current.save();
    });
    expect(result.current.loading).toBe(true);
    expect(mocks.close).not.toHaveBeenCalled();

    await act(async () => {
      resolveSave();
      await save;
    });
    expect(result.current.loading).toBe(false);
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it('handles rejection, clears loading, and allows a successful retry', async () => {
    mocks.updateAiModelsConfig.mockRejectedValueOnce(new Error('400 Bad Request'));
    const { result } = renderHook(() => useModelConfigSave({ formRef, id: 'gpt-4o' }));

    await act(async () => {
      await expect(result.current.save()).resolves.toBeUndefined();
    });
    expect(result.current.loading).toBe(false);
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith('operationFailed');

    mocks.updateAiModelsConfig.mockResolvedValueOnce(undefined);
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.loading).toBe(false);
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });
});
