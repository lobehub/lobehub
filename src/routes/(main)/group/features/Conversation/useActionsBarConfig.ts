'use client';

import { useMemo } from 'react';

import { type ActionsBarConfig } from '@/features/Conversation/types';

/**
 * Group-chat conversation action bar config. Currently relies on each role's
 * component-level defaults — no per-session overrides are needed yet.
 */
export const useActionsBarConfig = (): ActionsBarConfig =>
  useMemo<ActionsBarConfig>(() => ({}), []);
