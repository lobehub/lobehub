import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useKnowledgeMenuItems } from './useKnowledgeMenuItems';

const mockFiles = vi.hoisted(() => ({
  current: [] as { enabled: boolean; id: string; name: string; type: string }[],
}));
const mockKnowledgeBases = vi.hoisted(() => ({
  current: [] as { enabled: boolean; id: string; name: string }[],
}));
const mockCanConfigureResource = vi.hoisted(() => ({ current: true }));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: unknown) => unknown) =>
    selector({ toggleFile: vi.fn(), toggleKnowledgeBase: vi.fn() }),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgentFilesById: () => () => mockFiles.current,
    getAgentKnowledgeBasesById: () => () => mockKnowledgeBases.current,
  },
}));

vi.mock('../../hooks/useAgentId', () => ({ useAgentId: () => 'agent-1' }));
vi.mock('../../hooks/useChatInputResourceAccess', () => ({
  useChatInputResourceAccess: () => ({ canConfigureResource: mockCanConfigureResource.current }),
}));

const keysOf = (items: unknown[]) =>
  items.map((item) => (item as { key?: string }).key).filter(Boolean);

describe('useKnowledgeMenuItems', () => {
  beforeEach(() => {
    mockFiles.current = [];
    mockKnowledgeBases.current = [];
    mockCanConfigureResource.current = true;
  });

  // Regression: the picker entry is now unconditional, but `fileUpload` stays in
  // CHAT_ONLY_ACTIONS, so a group member who can chat/upload without edit access
  // still reaches this menu. Its getKnowledgeBasesAndFiles query asserts edit
  // access server-side, so offering the picker would open a modal that 403s.
  it('offers no knowledge entries when the member cannot configure the resource', () => {
    mockCanConfigureResource.current = false;
    mockKnowledgeBases.current = [{ enabled: true, id: 'kb-1', name: 'Handbook' }];

    const { result } = renderHook(() => useKnowledgeMenuItems({ onUpdatingChange: vi.fn() }));

    expect(result.current).toEqual([]);
  });

  it('offers the picker entry alongside the empty hint when nothing is attached', () => {
    const { result } = renderHook(() => useKnowledgeMenuItems({ onUpdatingChange: vi.fn() }));

    expect(keysOf(result.current)).toEqual(['knowledge-empty', 'knowledge-base-store']);
  });

  it('lists related files and libraries above the picker entry', () => {
    mockKnowledgeBases.current = [{ enabled: true, id: 'kb-1', name: 'Handbook' }];

    const { result } = renderHook(() => useKnowledgeMenuItems({ onUpdatingChange: vi.fn() }));

    expect(keysOf(result.current)).toEqual(['relativeFilesOrLibraries', 'knowledge-base-store']);
  });
});
