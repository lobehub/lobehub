'use client';

import { ForwardedRef, memo, useImperativeHandle } from 'react';
import { createStoreUpdater } from 'zustand-utils';

import { DEFAULT_AGENT_META } from '@/const/meta';
import { DEFAULT_AGENT_CONFIG } from '@/const/settings';

import { AgentSettingsInstance, useAgentSettings } from './hooks/useAgentSettings';
import { State, useStoreApi } from './store';

export interface StoreUpdaterProps extends Partial<
  Pick<State, 'onMetaChange' | 'onConfigChange' | 'meta' | 'config' | 'id' | 'loading'>
> {
  instanceRef?: ForwardedRef<AgentSettingsInstance> | null;
}

const StoreUpdater = memo<StoreUpdaterProps>(
  ({ onConfigChange, instanceRef, id, onMetaChange, meta, config, loading }) => {
    const storeApi = useStoreApi();
    const useStoreUpdater = createStoreUpdater(storeApi);

    useStoreUpdater('meta', meta || DEFAULT_AGENT_META);
    useStoreUpdater('config', config || DEFAULT_AGENT_CONFIG);
    useStoreUpdater('onConfigChange', onConfigChange);
    useStoreUpdater('onMetaChange', onMetaChange);
    useStoreUpdater('loading', loading);
    useStoreUpdater('id', id);

    const instance = useAgentSettings();
    useImperativeHandle(instanceRef, () => instance);

    return null;
  },
);

export default StoreUpdater;
