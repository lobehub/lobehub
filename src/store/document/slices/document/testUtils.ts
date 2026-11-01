/**
 * Shared fixtures of the document detail replica suites (`action*.test.ts`):
 * the SWR provider with the app's scoped mutate, server-shaped rows and the
 * persisted-row reader.
 */
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';

import { setScopedMutate } from '@/libs/swr/mutate';
import { initialEditorState } from '@/store/document/slices/editor';

import { initialDocumentDetailSliceState } from './initialState';
import { documentDetailResource } from './projection';

const MutateBridge = () => {
  const { mutate } = useSWRConfig();
  useEffect(() => setScopedMutate(mutate), [mutate]);
  return null;
};

export const wrapper = ({ children }: PropsWithChildren) =>
  createElement(
    SWRConfig,
    { value: { dedupingInterval: 0, provider: () => new Map() } },
    createElement(MutateBridge),
    children,
  );

export const baseEditorData = {
  root: { children: [{ children: [], type: 'paragraph' }], type: 'root' },
};

/** A document row as the server returns it. */
export const documentRow = (overrides: Record<string, unknown> = {}) =>
  ({
    content: '# Server',
    editorData: baseEditorData,
    id: 'doc-1',
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  }) as any;

/** Never-resolving fetch: the first frame can only come from storage. */
export const pending = () => new Promise<never>(() => {});

export const storedRow = (documentId: string, scope: string) =>
  documentDetailResource.storage!.get({ queryKey: documentId, scope });

export const detailSliceState = () => ({
  ...initialEditorState,
  ...initialDocumentDetailSliceState,
});
