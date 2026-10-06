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
  savedLabel: 'Saved',
  search: '',
};

describe('Model catalog view', () => {
  it('uses new CLI models without mixing in built-in choices', () => {
    const { result } = renderHook(() => useModelCatalogView({ ...defaults, data: loaded }));
    expect(result.current.rows).toEqual(loaded.models);
  });

  it('keeps only the saved model when no catalog is available', () => {
    const { result } = renderHook(() =>
      useModelCatalogView({ ...defaults, currentModel: 'custom-model' }),
    );
    expect(result.current.rows.map((model) => model.id)).toEqual(['custom-model']);
    expect(result.current.groups.Saved[0].id).toBe('custom-model');
    expect(result.current.selectedIsStale).toBe(false);
  });

  it('renders the last successful catalog supplied by the shared cache', () => {
    const { result } = renderHook(() => useModelCatalogView({ ...defaults, data: loaded }));
    expect(result.current.rows).toEqual(loaded.models);
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

  it('does not invent model choices before a catalog is available', () => {
    const { result } = renderHook(() => useModelCatalogView(defaults));
    expect(result.current.rows).toEqual([]);
    expect(result.current.groups).toEqual({});
  });
});
