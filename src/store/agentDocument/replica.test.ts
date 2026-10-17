/**
 * @vitest-environment happy-dom
 *
 * An agent's document list and the read-only reader are `@lobechat/replica`
 * resources: the persisted projection paints a cold start while the network
 * confirms it, client-side edits never reach storage, scopes stay isolated, and
 * the reader keeps only the fields it renders and forgets deleted documents.
 */
import { randomUUID } from 'node:crypto';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { type PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentDocumentItem } from '@/features/AgentDocumentPage/useAgentDocumentItem';
import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { type AgentDocumentListItem, agentDocumentService } from '@/services/agentDocument';

import { agentDocumentActions } from './action';
import { initialState } from './initialState';
import {
  agentDocumentListResource,
  type AgentDocumentReaderParams,
  agentDocumentReaderResource,
} from './projection';
import { agentDocumentSelectors } from './selectors';
import { useAgentDocumentStore } from './store';

const MutateBridge = () => {
  const { mutate } = useSWRConfig();
  useEffect(() => setScopedMutate(mutate), [mutate]);
  return null;
};
const wrapper = ({ children }: PropsWithChildren) =>
  createElement(
    SWRConfig,
    { value: { dedupingInterval: 0, provider: () => new Map() } },
    createElement(MutateBridge),
    children,
  );

const AGENT_ID = 'agent-1';
const READER: AgentDocumentReaderParams = { agentId: AGENT_ID, documentId: 'docs_1' };

const row = (id: string, overrides: Partial<AgentDocumentListItem> = {}): AgentDocumentListItem =>
  ({
    category: 'document',
    documentId: `docs_${id}`,
    filename: `${id}.md`,
    id,
    parentId: null,
    title: id,
    ...overrides,
  }) as AgentDocumentListItem;

/** Never-resolving fetch: what the store holds can only have come from storage. */
const pending = () => new Promise<never>(() => {});

const list = () =>
  agentDocumentSelectors.getDocumentList(AGENT_ID)(useAgentDocumentStore.getState());
const reader = () =>
  agentDocumentSelectors.getReaderDocument(READER)(useAgentDocumentStore.getState());

const LIST_KEY = agentDocumentListResource.storageKey(AGENT_ID);
const READER_KEY = agentDocumentReaderResource.storageKey(READER);

describe('agent document replicas', () => {
  const scopes = new Set<string>();
  let scope = '';

  const useScope = (next: string) => {
    scope = next;
    scopes.add(next);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  };

  const storedList = async () =>
    (await agentDocumentListResource.storage!.get({ queryKey: LIST_KEY, scope }))?.data;
  const storedReader = async () =>
    (await agentDocumentReaderResource.storage!.get({ queryKey: READER_KEY, scope }))?.data;

  beforeEach(() => {
    useScope(`agent-doc-user-${randomUUID()}:personal`);
    useAgentDocumentStore.setState({ ...initialState });
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(
      [...scopes].flatMap((value) => [
        agentDocumentListResource.storage!.remove({ queryKey: LIST_KEY, scope: value }),
        agentDocumentReaderResource.storage!.remove({ queryKey: READER_KEY, scope: value }),
      ]),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  describe('document list', () => {
    const renderSync = () =>
      renderHook(() => agentDocumentActions.useFetchDocumentList(AGENT_ID), { wrapper });

    it('caps how many agents keep a persisted list', () => {
      expect(agentDocumentListResource.maxPersistedEntries).toBe(30);
    });

    it('paints the persisted list before the network answers', async () => {
      await agentDocumentListResource.storage!.set(
        { queryKey: LIST_KEY, scope },
        { data: [row('a', { title: 'Cached' })], updatedAt: 1 },
      );
      vi.spyOn(agentDocumentService, 'listDocuments').mockImplementation(pending);

      renderSync();

      await waitFor(() => expect(list()).toHaveLength(1));
      expect(list()![0].title).toBe('Cached');
    });

    it('seeds the persisted list before anything mounts, for the docs route loader', async () => {
      await agentDocumentListResource.storage!.set(
        { queryKey: LIST_KEY, scope },
        { data: [row('a', { title: 'Cached' })], updatedAt: 1 },
      );
      const listDocuments = vi.spyOn(agentDocumentService, 'listDocuments');

      await expect(agentDocumentActions.preHydrateDocumentList(AGENT_ID)).resolves.toBe(true);

      // Already in the store when the sidebar first renders: no spinner frame.
      expect(list()![0].title).toBe('Cached');
      expect(listDocuments).not.toHaveBeenCalled();
    });

    it('leaves the list unloaded when nothing is persisted or no agent is routed', async () => {
      await expect(agentDocumentActions.preHydrateDocumentList(AGENT_ID)).resolves.toBe(false);
      await expect(agentDocumentActions.preHydrateDocumentList(undefined)).resolves.toBe(false);

      expect(list()).toBeUndefined();
    });

    it('persists the server answer for the next cold start', async () => {
      vi.spyOn(agentDocumentService, 'listDocuments').mockResolvedValue([row('a'), row('b')]);

      renderSync();

      await waitFor(() => expect(list()).toHaveLength(2));
      await waitFor(async () => expect(await storedList()).toHaveLength(2));
      expect(agentDocumentService.listDocuments).toHaveBeenCalledWith({ agentId: AGENT_ID });
    });

    it('keeps client-side edits in memory until the server confirms them', async () => {
      const listDocuments = vi
        .spyOn(agentDocumentService, 'listDocuments')
        .mockResolvedValue([row('a')]);
      renderSync();
      await waitFor(async () => expect(await storedList()).toHaveLength(1));

      // An optimistic insert shows at once but never reaches storage…
      await act(() =>
        agentDocumentActions.mutateDocumentList(AGENT_ID, (prev) => [...(prev ?? []), row('tmp')], {
          revalidate: false,
        }),
      );
      expect(list()!.map((doc) => doc.id)).toEqual(['a', 'tmp']);
      expect((await storedList())!.map((doc) => doc.id)).toEqual(['a']);

      // …until the server answers with the real row.
      listDocuments.mockResolvedValue([row('a'), row('b')]);
      await act(() => agentDocumentActions.mutateDocumentList(AGENT_ID));
      await waitFor(() => expect(list()!.map((doc) => doc.id)).toEqual(['a', 'b']));
      await waitFor(async () =>
        expect((await storedList())!.map((doc) => doc.id)).toEqual(['a', 'b']),
      );
    });

    it('drops the previous scope’s list on a cache-scope switch', async () => {
      const listDocuments = vi
        .spyOn(agentDocumentService, 'listDocuments')
        .mockResolvedValue([row('a')]);
      const { rerender } = renderSync();
      await waitFor(() => expect(list()).toHaveLength(1));

      useScope(`${scope.split(':')[0]}:ws-1`);
      listDocuments.mockImplementation(pending);
      rerender();

      expect(list()).toBeUndefined();
    });

    it('resolves the list on demand for a click that beats the first sync', async () => {
      vi.spyOn(agentDocumentService, 'listDocuments').mockResolvedValue([row('a')]);

      const docs = await agentDocumentActions.fetchDocumentList(AGENT_ID);

      expect(docs!.map((doc) => doc.id)).toEqual(['a']);
    });
  });

  describe('agent document page row', () => {
    it('paints the header row from the persisted list, without a loader', async () => {
      await agentDocumentListResource.storage!.set(
        { queryKey: LIST_KEY, scope },
        { data: [row('1', { title: 'Cached title' })], updatedAt: 1 },
      );
      vi.spyOn(agentDocumentService, 'listDocuments').mockImplementation(pending);

      const { result } = renderHook(() => useAgentDocumentItem(AGENT_ID, 'docs_1'), { wrapper });

      await waitFor(() => expect(result.current.item?.title).toBe('Cached title'));
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isNotFound).toBe(false);
    });

    it('does not call a document missing from the persisted list "not found" before the server answers', async () => {
      // An earlier session persisted the list before this document existed.
      await agentDocumentListResource.storage!.set(
        { queryKey: LIST_KEY, scope },
        { data: [row('old')], updatedAt: 1 },
      );
      let answer!: (docs: AgentDocumentListItem[]) => void;
      vi.spyOn(agentDocumentService, 'listDocuments').mockImplementation(
        () => new Promise((resolve) => (answer = resolve)),
      );

      const { result } = renderHook(() => useAgentDocumentItem(AGENT_ID, 'docs_new'), {
        wrapper,
      });

      await waitFor(() => expect(list()).toHaveLength(1));
      expect(result.current.isNotFound).toBe(false);
      expect(result.current.isLoading).toBe(true);

      await act(async () => answer([row('old'), row('new')]));

      await waitFor(() => expect(result.current.item?.id).toBe('new'));
      expect(result.current.isNotFound).toBe(false);
    });

    it('reports not found once the server list lacks the document', async () => {
      vi.spyOn(agentDocumentService, 'listDocuments').mockResolvedValue([row('old')]);

      const { result } = renderHook(() => useAgentDocumentItem(AGENT_ID, 'docs_gone'), {
        wrapper,
      });

      await waitFor(() => expect(result.current.isNotFound).toBe(true));
    });
  });

  describe('reader', () => {
    const renderSync = () =>
      renderHook(() => agentDocumentActions.useFetchReaderDocument(READER), { wrapper });

    it('caps how many reader bodies persist', () => {
      expect(agentDocumentReaderResource.maxPersistedEntries).toBe(20);
    });

    it('paints the persisted body before the network answers', async () => {
      await agentDocumentReaderResource.storage!.set(
        { queryKey: READER_KEY, scope },
        {
          data: { document: { content: '# Cached', filename: 'a.md', title: 'A' } },
          updatedAt: 1,
        },
      );
      vi.spyOn(agentDocumentService, 'getReaderDocument').mockImplementation(pending);

      renderSync();

      await waitFor(() => expect(reader()?.document?.content).toBe('# Cached'));
    });

    it('keeps only the rendered fields, never the editor state', async () => {
      vi.spyOn(agentDocumentService, 'getReaderDocument').mockResolvedValue({
        content: '# Body',
        editorData: { root: { children: [] } },
        filename: 'a.md',
        id: 'row-1',
        title: 'A',
      } as any);

      renderSync();

      await waitFor(async () =>
        expect(await storedReader()).toEqual({
          document: { content: '# Body', filename: 'a.md', title: 'A' },
        }),
      );
    });

    it('evicts the persisted body of a document the server no longer has', async () => {
      await agentDocumentReaderResource.storage!.set(
        { queryKey: READER_KEY, scope },
        {
          data: { document: { content: '# Deleted', filename: 'a.md', title: 'A' } },
          updatedAt: 1,
        },
      );
      vi.spyOn(agentDocumentService, 'getReaderDocument').mockRejectedValue(
        Object.assign(new Error('Agent document not found'), { data: { code: 'NOT_FOUND' } }),
      );

      renderSync();

      await waitFor(() => expect(reader()?.document).toBeNull());
      expect(reader()?.missingMessage).toBe('Agent document not found');
      await waitFor(async () => expect(await storedReader()).toBeUndefined());
    });

    it('evicts the persisted body once this session may no longer read it', async () => {
      await agentDocumentReaderResource.storage!.set(
        { queryKey: READER_KEY, scope },
        {
          data: { document: { content: '# Revoked', filename: 'a.md', title: 'A' } },
          updatedAt: 1,
        },
      );
      vi.spyOn(agentDocumentService, 'getReaderDocument').mockRejectedValue(
        Object.assign(new Error('Forbidden'), { data: { code: 'FORBIDDEN' } }),
      );

      renderSync();

      await waitFor(() => expect(reader()?.document).toBeNull());
      await waitFor(async () => expect(await storedReader()).toBeUndefined());
    });
  });
});
