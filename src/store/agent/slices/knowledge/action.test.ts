/**
 * @vitest-environment happy-dom
 *
 * Imperative knowledge behaviour: the add / remove / toggle actions keep their
 * `activeAgentId` guards and service parameters, and a knowledge mutation fans
 * out to every loaded visibility surface through `internal_refreshAgentKnowledge`.
 * The local-first wiring (hydration, cold start, scope switch) is covered by
 * `replica.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mutate } from '@/libs/swr';
import { agentService } from '@/services/agent';

import { initialState } from '../../initialState';
import { useAgentStore } from '../../store';
import { agentKnowledgeListKey } from './projection';

vi.mock('@/libs/swr', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/libs/swr');
  return { ...actual, mutate: vi.fn() };
});

vi.mock('@/libs/swr/useCacheScope', () => ({
  getCacheScope: () => 'u1:personal',
  isScopeTrusted: () => true,
  useCacheScope: () => 'u1:personal',
}));

vi.mock('@/services/agent', () => ({
  AVAILABLE_AGENTS_CONTEXT_QUERY_LIMIT: 12,
  agentService: {
    createAgentFiles: vi.fn(),
    createAgentKnowledgeBase: vi.fn(),
    deleteAgentFile: vi.fn(),
    deleteAgentKnowledgeBase: vi.fn(),
    getFilesAndKnowledgeBases: vi.fn(),
    toggleFile: vi.fn(),
    toggleKnowledgeBase: vi.fn(),
  },
}));

const AGENT_ID = 'agent-1';
const KNOWLEDGE_KEY = agentKnowledgeListKey({ agentId: AGENT_ID, visibility: 'private' });
const SYNC_KEY = [
  'replica:sync',
  'agentKnowledgeList',
  1,
  'u1:personal',
  KNOWLEDGE_KEY,
  { agentId: AGENT_ID, visibility: 'private' },
];

const reset = (activeAgentId?: string) => {
  useAgentStore.setState({ ...initialState, activeAgentId });
};

/** Predicates the store handed to the scoped `mutate` (replica revalidations). */
const revalidatePredicates = () =>
  vi.mocked(mutate).mock.calls.map(([key]) => key as (k: unknown) => boolean);

const expectKnowledgeRevalidated = () =>
  expect(revalidatePredicates().some((predicate) => predicate(SYNC_KEY))).toBe(true);

describe('KnowledgeSlice actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mutate).mockResolvedValue(undefined as never);
    vi.mocked(agentService.createAgentFiles).mockResolvedValue(undefined as never);
    vi.mocked(agentService.createAgentKnowledgeBase).mockResolvedValue(undefined as never);
    vi.mocked(agentService.deleteAgentFile).mockResolvedValue(undefined as never);
    vi.mocked(agentService.deleteAgentKnowledgeBase).mockResolvedValue(undefined as never);
    vi.mocked(agentService.toggleFile).mockResolvedValue(undefined as never);
    vi.mocked(agentService.toggleKnowledgeBase).mockResolvedValue(undefined as never);
    reset(AGENT_ID);
  });

  describe('addFilesToAgent', () => {
    it('should not call service if no activeAgentId', async () => {
      reset(undefined);
      await useAgentStore.getState().addFilesToAgent(['file-1', 'file-2']);
      expect(agentService.createAgentFiles).not.toHaveBeenCalled();
    });

    it('should not call service if fileIds is empty', async () => {
      await useAgentStore.getState().addFilesToAgent([]);
      expect(agentService.createAgentFiles).not.toHaveBeenCalled();
    });

    it('should call createAgentFiles with correct params and revalidate knowledge', async () => {
      await useAgentStore.getState().addFilesToAgent(['file-1', 'file-2'], true);

      expect(agentService.createAgentFiles).toHaveBeenCalledWith(
        AGENT_ID,
        ['file-1', 'file-2'],
        true,
      );
      expectKnowledgeRevalidated();
    });
  });

  describe('addKnowledgeBaseToAgent', () => {
    it('should not call service if no activeAgentId', async () => {
      reset(undefined);
      await useAgentStore.getState().addKnowledgeBaseToAgent('kb-1');
      expect(agentService.createAgentKnowledgeBase).not.toHaveBeenCalled();
    });

    it('should call createAgentKnowledgeBase with enabled=true', async () => {
      await useAgentStore.getState().addKnowledgeBaseToAgent('kb-1');
      expect(agentService.createAgentKnowledgeBase).toHaveBeenCalledWith(AGENT_ID, 'kb-1', true);
    });
  });

  describe('removeFileFromAgent', () => {
    it('should not call service if no activeAgentId', async () => {
      reset(undefined);
      await useAgentStore.getState().removeFileFromAgent('file-1');
      expect(agentService.deleteAgentFile).not.toHaveBeenCalled();
    });

    it('should call deleteAgentFile with correct params', async () => {
      await useAgentStore.getState().removeFileFromAgent('file-1');
      expect(agentService.deleteAgentFile).toHaveBeenCalledWith(AGENT_ID, 'file-1');
    });
  });

  describe('removeKnowledgeBaseFromAgent', () => {
    it('should not call service if no activeAgentId', async () => {
      reset(undefined);
      await useAgentStore.getState().removeKnowledgeBaseFromAgent('kb-1');
      expect(agentService.deleteAgentKnowledgeBase).not.toHaveBeenCalled();
    });

    it('should call deleteAgentKnowledgeBase with correct params', async () => {
      await useAgentStore.getState().removeKnowledgeBaseFromAgent('kb-1');
      expect(agentService.deleteAgentKnowledgeBase).toHaveBeenCalledWith(AGENT_ID, 'kb-1');
    });
  });

  describe('toggleFile', () => {
    it('should not call service if no activeAgentId', async () => {
      reset(undefined);
      await useAgentStore.getState().toggleFile('file-1', true);
      expect(agentService.toggleFile).not.toHaveBeenCalled();
    });

    it('should call toggleFile with correct params', async () => {
      await useAgentStore.getState().toggleFile('file-1', true);
      expect(agentService.toggleFile).toHaveBeenCalledWith(AGENT_ID, 'file-1', true);
    });

    it('should call toggleFile with open=false', async () => {
      await useAgentStore.getState().toggleFile('file-1', false);
      expect(agentService.toggleFile).toHaveBeenCalledWith(AGENT_ID, 'file-1', false);
    });
  });

  describe('toggleKnowledgeBase', () => {
    it('should not call service if no activeAgentId', async () => {
      reset(undefined);
      await useAgentStore.getState().toggleKnowledgeBase('kb-1', true);
      expect(agentService.toggleKnowledgeBase).not.toHaveBeenCalled();
    });

    it('should call toggleKnowledgeBase with correct params', async () => {
      await useAgentStore.getState().toggleKnowledgeBase('kb-1', true);
      expect(agentService.toggleKnowledgeBase).toHaveBeenCalledWith(AGENT_ID, 'kb-1', true);
    });

    it('should call toggleKnowledgeBase with open=false', async () => {
      await useAgentStore.getState().toggleKnowledgeBase('kb-1', false);
      expect(agentService.toggleKnowledgeBase).toHaveBeenCalledWith(AGENT_ID, 'kb-1', false);
    });
  });

  describe('internal_refreshAgentKnowledge', () => {
    it('revalidates the knowledge replica of the active scope', async () => {
      await useAgentStore.getState().internal_refreshAgentKnowledge();
      expectKnowledgeRevalidated();
    });
  });
});
