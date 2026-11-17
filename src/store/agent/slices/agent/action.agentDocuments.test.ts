import type { AgentContextDocument } from '@lobechat/context-engine';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveAgentDocumentsContext } from '@/services/agentDocument';
import { invalidateDocumentMutation } from '@/services/document/invalidation';

import { useAgentStore } from '../../store';

vi.mock('@/services/agentDocument', () => ({
  resolveAgentDocumentsContext: vi.fn(),
}));

const doc = (id: string, policyLoad: AgentContextDocument['policyLoad']): AgentContextDocument => ({
  filename: `${id}.md`,
  id,
  policyLoad,
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

describe('agent context documents cache', () => {
  afterEach(() => {
    useAgentStore.setState({ agentDocumentsMap: {} });
    vi.resetAllMocks();
  });

  it('serves the cached list until the agent documents are invalidated', async () => {
    vi.mocked(resolveAgentDocumentsContext)
      .mockResolvedValueOnce([doc('checklist', 'progressive')])
      .mockResolvedValueOnce([doc('checklist', 'always')]);
    const store = useAgentStore.getState();

    await expect(store.ensureAgentDocuments('agent-1')).resolves.toEqual([
      doc('checklist', 'progressive'),
    ]);
    await store.ensureAgentDocuments('agent-1');
    expect(resolveAgentDocumentsContext).toHaveBeenCalledTimes(1);

    store.invalidateAgentDocuments('agent-1');

    await expect(store.ensureAgentDocuments('agent-1')).resolves.toEqual([
      doc('checklist', 'always'),
    ]);
    expect(resolveAgentDocumentsContext).toHaveBeenCalledTimes(2);
  });

  // T-14044: in browser-run chats, a document created or switched to "always"
  // by a tool call stayed out of the model context until a page reload.
  it('refetches after an agent document mutation', async () => {
    vi.mocked(resolveAgentDocumentsContext)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([doc('checklist', 'always')]);
    const store = useAgentStore.getState();

    await store.ensureAgentDocuments('agent-1');
    await invalidateDocumentMutation({ agentId: 'agent-1', cause: 'agent-document' });

    await expect(store.ensureAgentDocuments('agent-1')).resolves.toEqual([
      doc('checklist', 'always'),
    ]);
  });

  it('does not cache a list fetched before the invalidation', async () => {
    const stale = deferred<AgentContextDocument[]>();
    vi.mocked(resolveAgentDocumentsContext)
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce([doc('checklist', 'always')]);
    const store = useAgentStore.getState();

    const inFlight = store.ensureAgentDocuments('agent-1');
    store.invalidateAgentDocuments('agent-1');
    stale.resolve([doc('checklist', 'progressive')]);
    await inFlight;

    expect(useAgentStore.getState().agentDocumentsMap['agent-1']).toBeUndefined();
    await expect(store.ensureAgentDocuments('agent-1')).resolves.toEqual([
      doc('checklist', 'always'),
    ]);
  });

  it('leaves other agents cached', async () => {
    vi.mocked(resolveAgentDocumentsContext).mockResolvedValue([doc('notes', 'progressive')]);
    const store = useAgentStore.getState();
    await store.ensureAgentDocuments('agent-2');

    store.invalidateAgentDocuments('agent-1');

    expect(useAgentStore.getState().agentDocumentsMap['agent-2']).toEqual([
      doc('notes', 'progressive'),
    ]);
  });
});
