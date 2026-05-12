import { type IFeatureFlagsState } from '@/config/featureFlags';
import { type StoreSetter } from '@/store/types';

import { type ServerConfigStore } from '../../store';
import {
  clearPersistedOverrides,
  readPersistedOverrides,
  writePersistedOverrides,
} from './storage';

const isDevEnv = () => process.env.NODE_ENV === 'development';

export type FeatureFlagKey = keyof IFeatureFlagsState;

type Setter = StoreSetter<ServerConfigStore>;

export interface FeatureFlagOverrideAction {
  /** dev panel: clear all overrides and restore featureFlags from snapshot */
  resetFlagOverrides: () => void;
  /** dev panel: write override (true|false) or clear override (undefined) for a single flag */
  setFlagOverride: (key: FeatureFlagKey, value: boolean | undefined) => void;
  /** Hydrator: snapshot current featureFlags as original, then merge persisted overrides */
  syncDevFlagOverrides: () => void;
}

export const createFeatureFlagOverrideSlice = (
  set: Setter,
  get: () => ServerConfigStore,
  _api?: unknown,
) => new FeatureFlagOverrideActionImpl(set, get, _api);

class FeatureFlagOverrideActionImpl implements FeatureFlagOverrideAction {
  readonly #set: Setter;
  readonly #get: () => ServerConfigStore;

  constructor(set: Setter, get: () => ServerConfigStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  syncDevFlagOverrides = () => {
    if (!isDevEnv()) return;

    const { featureFlags } = this.#get();
    const original = { ...featureFlags } as IFeatureFlagsState;

    const knownKeys = new Set<string>(Object.keys(original));
    const persisted = readPersistedOverrides(knownKeys) as Partial<IFeatureFlagsState>;

    const merged = { ...original, ...persisted } as IFeatureFlagsState;

    this.#set(
      {
        _featureFlagOverrides: persisted,
        _originalFeatureFlags: original,
        featureFlags: merged,
      },
      false,
      'syncDevFlagOverrides',
    );
  };

  setFlagOverride = (key: FeatureFlagKey, value: boolean | undefined) => {
    if (!isDevEnv()) return;

    const state = this.#get();
    const original = state._originalFeatureFlags;
    if (!original) return;

    const nextOverrides = { ...state._featureFlagOverrides } as Partial<IFeatureFlagsState>;
    const nextFlags = { ...state.featureFlags } as IFeatureFlagsState;

    if (value === undefined) {
      delete nextOverrides[key];
      (nextFlags as Record<string, unknown>)[key] = (original as Record<string, unknown>)[key];
    } else {
      (nextOverrides as Record<string, boolean>)[key] = value;
      (nextFlags as Record<string, unknown>)[key] = value;
    }

    writePersistedOverrides(nextOverrides as Record<string, boolean>);

    this.#set(
      { _featureFlagOverrides: nextOverrides, featureFlags: nextFlags },
      false,
      'setFlagOverride',
    );
  };

  resetFlagOverrides = () => {
    if (!isDevEnv()) return;

    const original = this.#get()._originalFeatureFlags;
    if (!original) return;

    clearPersistedOverrides();

    this.#set(
      { _featureFlagOverrides: {}, featureFlags: { ...original } },
      false,
      'resetFlagOverrides',
    );
  };
}

export type { FeatureFlagOverrideActionImpl };
