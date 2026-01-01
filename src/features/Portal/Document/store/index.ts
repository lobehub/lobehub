'use client';

import { type StoreApiWithSelector } from '@lobechat/types';
import { createContext } from 'zustand-utils';
import { subscribeWithSelector } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import { type DocumentEditorStore, createDocumentEditorStore } from './action';
import { type DocumentEditorState } from './initialState';

export type { DocumentEditorState } from './initialState';

export const createStore = (initState?: Partial<DocumentEditorState>) =>
  createWithEqualityFn(subscribeWithSelector(createDocumentEditorStore(initState)), shallow);

export const {
  useStore: useDocumentEditorStore,
  useStoreApi: useDocumentEditorStoreApi,
  Provider: DocumentEditorProvider,
} = createContext<StoreApiWithSelector<DocumentEditorStore>>();
