import type { HeterogeneousAgentModelCatalogSuccess } from '@lobechat/types';
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useModelCatalogView } from './useModelCatalogView';

const loaded: HeterogeneousAgentModelCatalogSuccess = {
  models: [
    { id: 'future-model', label: 'Future model', modelId: 'future-model', providerId: 'codex' },
  ],
  status: 'success',
  updatedAt: 1,
};
const defaults = {
  currentModel: 'default',
  hasError: false,
  savedLabel: 'Saved',
  search: '',
  targetReady: true,
  type: 'codex',
};

describe('Codex model picker state', () => {
  it('uses new CLI models without mixing in built-in choices', () => {
    const { result } = renderHook(() => useModelCatalogView({ ...defaults, data: loaded }));
    expect(result.current.rows).toEqual(loaded.models);
    expect(result.current.useFallback).toBe(false);
  });

  it('offers built-in choices and the saved custom model when discovery fails', () => {
    const { result } = renderHook(() =>
      useModelCatalogView({ ...defaults, currentModel: 'custom-model', hasError: true }),
    );
    expect(result.current.rows.map((model) => model.id)).toContain('gpt-6-astra');
    expect(result.current.groups.Saved[0].id).toBe('custom-model');
    expect(result.current.useFallback).toBe(true);
    expect(result.current.selectedIsStale).toBe(false);
  });

  it('retains the last successful catalog on refresh failure', () => {
    const { result } = renderHook(() =>
      useModelCatalogView({ ...defaults, data: loaded, hasError: true }),
    );
    expect(result.current.rows).toEqual(loaded.models);
    expect(result.current.useFallback).toBe(false);
  });

  it('keeps off-catalog saved models pickable and marks them as stale only after discovery', () => {
    const { result, rerender } = renderHook(
      ({ data }) => useModelCatalogView({ ...defaults, currentModel: 'custom-model', data }),
      {
        initialProps: { data: undefined as HeterogeneousAgentModelCatalogSuccess | undefined },
      },
    );
    expect(result.current.rows[0].id).toBe('custom-model');
    expect(result.current.selectedIsStale).toBe(false);
    rerender({ data: loaded });
    expect(result.current.rows.map((model) => model.id)).toEqual(['custom-model', 'future-model']);
    expect(result.current.selectedIsStale).toBe(true);
  });

  it('does not replace an intentionally empty catalog with built-in models', () => {
    const { result } = renderHook(() =>
      useModelCatalogView({ ...defaults, data: { ...loaded, models: [] } }),
    );
    expect(result.current.rows).toEqual([]);
    expect(result.current.useFallback).toBe(false);
  });

  it('searches dynamic model names and saved values', () => {
    const { result } = renderHook(() =>
      useModelCatalogView({
        ...defaults,
        data: loaded,
        currentModel: 'saved-model',
        search: 'FUTURE',
      }),
    );
    expect(result.current.rows).toEqual(loaded.models);
  });

  it('falls back while the target is unavailable but not during the first load', () => {
    const { result, rerender } = renderHook(
      ({ targetReady }) => useModelCatalogView({ ...defaults, targetReady }),
      { initialProps: { targetReady: false } },
    );
    expect(result.current.useFallback).toBe(true);
    rerender({ targetReady: true });
    expect(result.current.useFallback).toBe(false);
    expect(result.current.rows).toEqual([]);
  });
});
