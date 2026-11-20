'use client';

import { subscribeWithSelector } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import { useFileStore } from '@/store/file';

import type { Store } from './action';
import { store } from './action';

export type { State } from './initialState';

export const createStore = () =>
  createWithEqualityFn<Store>()(subscribeWithSelector(store()), shallow);

export const useResourceManagerStore = createStore();

export { selectors } from './selectors';

export const useResourceManagerFetchFolderBreadcrumb = (slug?: string | null) => {
  return useFileStore((s) => s.useFetchFolderBreadcrumb)(slug);
};
