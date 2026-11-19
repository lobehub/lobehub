import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentService } from '@/services/agent';

import { useAgentStore } from '../../store';

vi.mock('@/services/agent', () => ({
  AVAILABLE_AGENTS_CONTEXT_QUERY_LIMIT: 12,
  agentService: {
    getAgentConfigById: vi.fn(),
    getBuiltinAgent: vi.fn(),
    queryAgents: vi.fn(),
    resetInboxAgent: vi.fn(),
    updateAgentMeta: vi.fn(),
  },
}));

const inboxId = 'inbox-agent';

const customized = {
  avatar: '🏗️',
  editorData: { root: { children: [] } },
  id: inboxId,
  name: 'Arquiteto',
  slug: 'inbox',
  systemRole: 'You are an architect.',
  title: 'Arquiteto Kolden',
};

const pristine = { id: inboxId, model: 'default-model', slug: 'inbox', title: 'Lobe AI' };

describe('resetInboxAgent', () => {
  beforeEach(() => {
    useAgentStore.setState({
      agentMap: { [inboxId]: customized },
      builtinAgentIdMap: { inbox: inboxId },
      builtinAgentMap: { inbox: customized as any },
    });
  });

  afterEach(() => {
    useAgentStore.setState({ agentMap: {}, builtinAgentIdMap: {}, builtinAgentMap: {} });
    vi.clearAllMocks();
  });

  it('replaces the cached config so cleared fields do not survive', async () => {
    vi.mocked(agentService.resetInboxAgent).mockResolvedValue({
      agent: pristine as any,
      success: true,
    });

    await useAgentStore.getState().resetInboxAgent(inboxId);

    expect(agentService.resetInboxAgent).toHaveBeenCalledWith(inboxId);
    expect(useAgentStore.getState().agentMap[inboxId]).toEqual(pristine);
    expect(useAgentStore.getState().builtinAgentMap.inbox).toEqual(pristine);
  });

  it('aborts a metadata save still in flight for the agent', async () => {
    let metaSignal: AbortSignal | undefined;
    vi.mocked(agentService.updateAgentMeta).mockImplementation(
      (_id, _meta, signal) =>
        new Promise((_resolve, reject) => {
          metaSignal = signal;
          signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        }),
    );
    vi.mocked(agentService.resetInboxAgent).mockResolvedValue({
      agent: pristine as any,
      success: true,
    });

    const pendingSave = useAgentStore.getState().updateAgentMetaById(inboxId, { title: 'Draft' });
    await useAgentStore.getState().resetInboxAgent(inboxId);
    await pendingSave;

    expect(metaSignal?.aborted).toBe(true);
    expect(useAgentStore.getState().agentMap[inboxId]).toEqual(pristine);
  });

  it('leaves the cached config alone and rethrows when the request fails', async () => {
    vi.mocked(agentService.resetInboxAgent).mockRejectedValue(new Error('boom'));

    await expect(useAgentStore.getState().resetInboxAgent(inboxId)).rejects.toThrow('boom');

    expect(useAgentStore.getState().agentMap[inboxId]).toEqual(customized);
  });
});
