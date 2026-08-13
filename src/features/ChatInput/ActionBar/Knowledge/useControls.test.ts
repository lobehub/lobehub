import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useControls } from './useControls';

const mockFiles = vi.hoisted(() => ({
  current: [] as { enabled: boolean; id: string; name: string; type: string }[],
}));
const mockKnowledgeBases = vi.hoisted(() => ({
  current: [] as { enabled: boolean; id: string; name: string }[],
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: unknown) => unknown) =>
    selector({ toggleFile: vi.fn(), toggleKnowledgeBase: vi.fn() }),
}));

vi.mock('@/store/agent/projection', () => ({
  agentProjectionSelectors: {
    files: (agent: { files: unknown[] }) => agent.files,
    knowledgeBases: (agent: { knowledgeBases: unknown[] }) => agent.knowledgeBases,
  },
  useAgentValue: (_agentId: string, selector: (agent: Record<string, unknown>) => unknown) =>
    selector({ files: mockFiles.current, knowledgeBases: mockKnowledgeBases.current }),
}));

vi.mock('../../hooks/useAgentId', () => ({ useAgentId: () => 'agent-1' }));

describe('useControls', () => {
  beforeEach(() => {
    mockFiles.current = [];
    mockKnowledgeBases.current = [];
  });

  // Regression: the footer was only built once something was already attached, so a
  // fresh agent showed "No related files or libraries" with no way in — the first
  // library or file could never be attached from the composer.
  it('keeps the picker reachable when nothing is attached yet', () => {
    const openAttachKnowledgeModal = vi.fn();

    const { result } = renderHook(() => useControls({ openAttachKnowledgeModal }));

    expect(result.current.items).toHaveLength(0);
    expect(result.current.footer).not.toBeNull();

    render(result.current.footer as ReactElement);
    fireEvent.click(screen.getByRole('button', { name: 'knowledgeBase.related.browse' }));

    expect(openAttachKnowledgeModal).toHaveBeenCalledTimes(1);
  });

  it('switches the footer to "view more" once libraries or files are attached', () => {
    mockKnowledgeBases.current = [{ enabled: true, id: 'kb-1', name: 'Handbook' }];
    const openAttachKnowledgeModal = vi.fn();

    const { result } = renderHook(() => useControls({ openAttachKnowledgeModal }));

    expect(result.current.items).toHaveLength(1);
    expect(result.current.enabledCount).toBe(1);

    render(result.current.footer as ReactElement);
    fireEvent.click(screen.getByRole('button', { name: 'knowledgeBase.viewMore' }));

    expect(openAttachKnowledgeModal).toHaveBeenCalledTimes(1);
  });
});
