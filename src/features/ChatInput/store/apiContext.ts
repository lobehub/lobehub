'use client';

import { type StoreApiWithSelector } from '@lobechat/types';
import { createContext, useContext } from 'react';

import { type Store } from './action';

// Kept apart from `./index` (which pulls the store actions, and with them the
// editor) so Home cold-path hooks such as `useAgentModelSelection` can read it.

/**
 * Parallel context that mirrors the ChatInput store api. zustand-utils' own
 * context throws ("...used zustand provider as an ancestor.") when read without
 * a Provider, so it cannot answer "is there a store here?". Components reused
 * outside a chat input — e.g. the image/video generation prompt reuses
 * ChatInput's <Action> — read this to degrade gracefully instead of crashing.
 */
export const ChatInputStoreApiContext = createContext<StoreApiWithSelector<Store> | undefined>(
  undefined,
);

/** The ChatInput store api, or `undefined` when rendered outside a Provider. */
export const useChatInputStoreApiOptional = (): StoreApiWithSelector<Store> | undefined =>
  useContext(ChatInputStoreApiContext);
