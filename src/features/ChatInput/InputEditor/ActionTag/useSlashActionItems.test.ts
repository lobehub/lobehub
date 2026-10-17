/**
 * @vitest-environment happy-dom
 *
 * Drives the REAL slash menu hook (the ChatInput consumer) against the real
 * tool store and the agent-document skills replica, so the migration is checked
 * at the product seam rather than only in the slice.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { agentDocumentService } from '@/services/agentDocument';
import { invalidateDocumentMutation } from '@/services/document/invalidation';
import { useAgentStore } from '@/store/agent';
import { useToolStore } from '@/store/tool';

import { useSlashActionItems } from './useSlashActionItems';

vi.mock('@/features/ChatInput/store', () => ({
  useChatInputStore: (selector: (state: { agentId: string; editor: undefined }) => unknown) =>
    selector({ agentId: 'agent-1', editor: undefined }),
}));

vi.mock('@/services/agentDocument', () => ({
  agentDocumentService: { listDocuments: vi.fn() },
}));

const skillDoc = (filename: string, title: string) => ({
  description: null,
  documentId: `doc-${filename}`,
  filename,
  isSkillBundle: true,
  title,
});

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

/** The agent-skill entries the menu currently offers. */
const agentSkillItems = (items: any[]) =>
  items.filter((item) => item.metadata?.category === 'agentSkill');

describe('useSlashActionItems · agent-document skills', () => {
  const listDocuments = () => vi.mocked(agentDocumentService.listDocuments);

  beforeEach(() => {
    vi.spyOn(cacheScope, 'get').mockImplementation(() => 'use-slash-scope');
    vi.spyOn(cacheScope, 'use').mockImplementation(() => 'use-slash-scope');
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    act(() => useAgentStore.setState({ activeAgentId: 'agent-1' }));
    listDocuments().mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('lists the agent’s skill bundles with their display title', async () => {
    listDocuments().mockResolvedValue([skillDoc('release-notes', 'Release notes')] as any);

    const { result } = renderHook(() => useSlashActionItems(), { wrapper });
    await waitFor(() =>
      expect(
        agentSkillItems(useToolStore.getState().agentDocumentSkillsMap['agent-1'] ?? []),
      ).toBeDefined(),
    );
    await waitFor(async () => expect(agentSkillItems(await result.current(null))).toHaveLength(1));

    const [skill] = agentSkillItems(await result.current(null));
    expect(skill).toMatchObject({
      key: 'agent-skill-agent-skills:release-notes',
      label: 'Release notes',
      metadata: { category: 'agentSkill', type: 'agent-skills:release-notes' },
    });
  });

  it('picks up a newly converted skill bundle after a document mutation, without a remount', async () => {
    listDocuments().mockResolvedValue([skillDoc('release-notes', 'Release notes')] as any);

    const { result } = renderHook(() => useSlashActionItems(), { wrapper });
    await waitFor(async () => expect(agentSkillItems(await result.current(null))).toHaveLength(1));

    // The user converts another document into a skill bundle elsewhere in the app.
    listDocuments().mockResolvedValue([
      skillDoc('release-notes', 'Release notes'),
      skillDoc('support-triage', 'Support triage'),
    ] as any);
    await act(() => invalidateDocumentMutation({ agentId: 'agent-1' }));

    await waitFor(async () =>
      expect(agentSkillItems(await result.current(null)).map((item: any) => item.label)).toEqual([
        'Release notes',
        'Support triage',
      ]),
    );
  });
});
