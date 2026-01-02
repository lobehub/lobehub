'use client';

import { useMemo } from 'react';

import { useStoreApi } from '../store';
import { type PublicAction } from '../store/action';

export type GroupChatSettingsInstance = PublicAction;

export const useGroupChatSettings = (): GroupChatSettingsInstance => {
  const storeApi = useStoreApi();

  const { updateGroupConfig, updateGroupMeta, resetGroupConfig, resetGroupMeta } =
    storeApi.getState();

  return useMemo(
    () => ({
      resetGroupConfig,
      resetGroupMeta,
      updateGroupConfig,
      updateGroupMeta,
    }),
    [],
  );
};
