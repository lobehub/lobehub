import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useTelemetrySubmit } from './useTelemetrySubmit';

describe('useTelemetrySubmit', () => {
  it('initializes the choice from persisted telemetry consent', () => {
    const { result } = renderHook(() =>
      useTelemetrySubmit({
        initialTelemetryEnabled: true,
        onNext: vi.fn(),
        updateGeneralConfig: vi.fn(),
      }),
    );

    expect(result.current.telemetryEnabled).toBe(true);
  });

  it('waits for telemetry persistence before advancing', async () => {
    let resolveSave!: () => void;
    const save = new Promise<void>((resolve) => {
      resolveSave = resolve;
    });
    const updateGeneralConfig = vi.fn().mockReturnValue(save);
    const onNext = vi.fn();
    const { result } = renderHook(() =>
      useTelemetrySubmit({
        initialTelemetryEnabled: false,
        onNext,
        updateGeneralConfig,
      }),
    );

    let submit!: Promise<void>;
    act(() => {
      submit = result.current.handleSubmit();
    });

    expect(updateGeneralConfig).toHaveBeenCalledWith({ telemetry: false });
    expect(onNext).not.toHaveBeenCalled();
    expect(result.current.isSaving).toBe(true);

    await act(async () => {
      resolveSave();
      await submit;
    });

    expect(onNext).toHaveBeenCalledTimes(1);
    expect(result.current.isSaving).toBe(false);
  });

  it('keeps navigation blocked and allows retry when telemetry persistence fails', async () => {
    const error = new Error('save failed');
    const updateGeneralConfig = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onNext = vi.fn();
    const { result } = renderHook(() =>
      useTelemetrySubmit({
        initialTelemetryEnabled: true,
        onNext,
        updateGeneralConfig,
      }),
    );

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(onNext).not.toHaveBeenCalled();
    expect(result.current.hasSaveError).toBe(true);
    expect(result.current.isSaving).toBe(false);
    expect(consoleError).toHaveBeenCalledWith(
      '[Onboarding] Failed to save telemetry preference:',
      error,
    );

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(onNext).toHaveBeenCalledTimes(1);
    expect(result.current.hasSaveError).toBe(false);

    consoleError.mockRestore();
  });
});
