/**
 * @vitest-environment happy-dom
 *
 * Workbench never mounts the user store. Its replica scope keeps public
 * surfaces network-only, and lets the agent document reader paint its last-read
 * body on a cold start while its own session check confirms the account.
 */
import { randomUUID } from 'node:crypto';

import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope, setReplicaScopeSource } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { agentDocumentService } from '@/services/agentDocument';
import {
  agentDocumentActions,
  agentDocumentSelectors,
  useAgentDocumentStore,
} from '@/store/agentDocument';
import { initialState } from '@/store/agentDocument/initialState';
import {
  type AgentDocumentReaderParams,
  agentDocumentReaderResource,
} from '@/store/agentDocument/projection';

import { workbenchRoutes } from '../router';
import { agentDocumentReaderLoader } from '../routes/agent/docs/[docId]/readerLoader';
import {
  enableWorkbenchIdentity,
  resetWorkbenchReplicaScope,
  workbenchReplicaScope,
} from './workbenchReplicaScope';

const ACTIVE_SCOPE_KEY = 'lobehub:active-scope';
const READER: AgentDocumentReaderParams = { agentId: 'agt_1', documentId: 'docs_1' };
const READER_KEY = agentDocumentReaderResource.storageKey(READER);

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

const pending = () => new Promise<never>(() => {});
const reader = () =>
  agentDocumentSelectors.getReaderDocument(READER)(useAgentDocumentStore.getState());
const renderReader = () =>
  renderHook(() => agentDocumentActions.useFetchReaderDocument(READER), { wrapper });

const sessionResponse = (body: unknown, status = 200) =>
  ({ json: async () => body, ok: status >= 200 && status < 300, status }) as Response;

describe('workbench replica scope', () => {
  let userId = '';
  const touched = new Set<string>();

  const persistReaderBody = async (scope: string, content: string) => {
    touched.add(scope);
    await agentDocumentReaderResource.storage!.set(
      { queryKey: READER_KEY, scope },
      { data: { document: { content, filename: 'a.md', title: 'A' } }, updatedAt: 1 },
    );
  };
  const storedReader = async (scope: string) =>
    (await agentDocumentReaderResource.storage!.get({ queryKey: READER_KEY, scope }))?.data;

  beforeEach(() => {
    userId = `wb-user-${randomUUID()}`;
    localStorage.clear();
    resetWorkbenchReplicaScope();
    setReplicaScopeSource(workbenchReplicaScope);
    useAgentDocumentStore.setState({ ...initialState });
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(
      [...touched].map((scope) =>
        agentDocumentReaderResource.storage!.remove({ queryKey: READER_KEY, scope }),
      ),
    );
    touched.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps public surfaces network-only: no hydrate, no persist', () => {
    localStorage.setItem(ACTIVE_SCOPE_KEY, `${userId}:ws_1`);

    expect(cacheScope.canHydrate?.()).toBe(false);
    expect(cacheScope.canPersist()).toBe(false);
    expect(cacheScope.get()).toBe('anon:workbench');
  });

  it('paints the last-read body on a cold start while the session check is in flight', async () => {
    localStorage.setItem(ACTIVE_SCOPE_KEY, `${userId}:ws_1`);
    await persistReaderBody(`${userId}:workbench`, '# Cached');
    vi.stubGlobal('fetch', vi.fn(pending));
    vi.spyOn(agentDocumentService, 'getReaderDocument').mockImplementation(pending);

    void enableWorkbenchIdentity();
    expect(cacheScope.canPersist()).toBe(false);

    renderReader();

    await waitFor(() => expect(reader()?.document?.content).toBe('# Cached'));
  });

  it('seeds the last-read body in the route loader, before the reader mounts', async () => {
    localStorage.setItem(ACTIVE_SCOPE_KEY, `${userId}:ws_1`);
    await persistReaderBody(`${userId}:workbench`, '# Cached');
    vi.stubGlobal('fetch', vi.fn(pending));
    const getReaderDocument = vi.spyOn(agentDocumentService, 'getReaderDocument');

    const route = workbenchRoutes[0].children!.find((r) => r.path === 'agent/:aid/docs/:docId');
    expect(route?.loader).toBeTypeOf('function');

    // Bare ids, as in the mobile URL; the loader adds the prefixes.
    await agentDocumentReaderLoader({ params: { aid: '1', docId: '1' } } as never);

    // Already in the store when the reader first renders: no spinner frame.
    expect(reader()?.document?.content).toBe('# Cached');
    expect(getReaderDocument).not.toHaveBeenCalled();
  });

  it('persists the server answer once the session confirms the same account', async () => {
    localStorage.setItem(ACTIVE_SCOPE_KEY, `${userId}:ws_1`);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sessionResponse({ user: { id: userId } })),
    );
    vi.spyOn(agentDocumentService, 'getReaderDocument').mockResolvedValue({
      content: '# Fresh',
      filename: 'a.md',
      title: 'A',
    } as any);
    touched.add(`${userId}:workbench`);

    await enableWorkbenchIdentity();
    expect(cacheScope.canPersist()).toBe(true);
    renderReader();

    await waitFor(async () =>
      expect((await storedReader(`${userId}:workbench`))?.document?.content).toBe('# Fresh'),
    );
    // The main SPA's workspace part is left alone for the same account.
    expect(localStorage.getItem(ACTIVE_SCOPE_KEY)).toBe(`${userId}:ws_1`);
  });

  it('drops the painted body when the session belongs to another account', async () => {
    const other = `wb-other-${randomUUID()}`;
    localStorage.setItem(ACTIVE_SCOPE_KEY, `${userId}:personal`);
    await persistReaderBody(`${userId}:workbench`, '# Previous account');
    let answer!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))),
    );
    vi.spyOn(agentDocumentService, 'getReaderDocument').mockImplementation(pending);

    const check = enableWorkbenchIdentity();
    renderReader();
    await waitFor(() => expect(reader()?.document?.content).toBe('# Previous account'));

    answer(sessionResponse({ user: { id: other } }));
    await check;

    await waitFor(() => expect(reader()).toBeUndefined());
    expect(cacheScope.get()).toBe(`${other}:workbench`);
    expect(localStorage.getItem(ACTIVE_SCOPE_KEY)).toBe(`${other}:personal`);
  });

  it('treats a signed-out session as nobody and forgets the last-known account', async () => {
    localStorage.setItem(ACTIVE_SCOPE_KEY, `${userId}:personal`);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sessionResponse(null)),
    );

    await enableWorkbenchIdentity();

    expect(cacheScope.get()).toBe('anon:workbench');
    expect(cacheScope.canPersist()).toBe(false);
    expect(localStorage.getItem(ACTIVE_SCOPE_KEY)).toBeNull();
  });

  it('does not take a failed session check as a sign-out', async () => {
    localStorage.setItem(ACTIVE_SCOPE_KEY, `${userId}:personal`);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sessionResponse({}, 503)),
    );

    await enableWorkbenchIdentity();

    expect(cacheScope.get()).toBe(`${userId}:workbench`);
    expect(cacheScope.canPersist()).toBe(false);
    expect(localStorage.getItem(ACTIVE_SCOPE_KEY)).toBe(`${userId}:personal`);
  });
});
