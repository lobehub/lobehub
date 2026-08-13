import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentIdentityForm } from './useAgentIdentityForm';

const mocks = vi.hoisted(() => ({
  agentMap: {} as Record<string, { name?: string; slug?: string; title?: string }>,
  refreshAgentConfig: vi.fn(),
  refreshAgentList: vi.fn(),
  updateAgentMetaById: vi.fn(),
  updateAgentSlug: vi.fn(),
}));

vi.mock('@/store/home', () => ({
  useHomeStore: (selector: (state: unknown) => unknown) =>
    selector({ refreshAgentList: mocks.refreshAgentList }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/services/agent', () => ({
  agentService: {
    updateAgentSlug: (...args: unknown[]) => mocks.updateAgentSlug(...args),
  },
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: unknown) => unknown) =>
    selector({
      internal_refreshAgentConfig: mocks.refreshAgentConfig,
      updateAgentMetaById: mocks.updateAgentMetaById,
    }),
}));

vi.mock('@/store/agent/projection', () => ({
  agentProjectionSelectors: {
    slug: (agent?: { slug?: string }) => agent?.slug,
  },
  useAgentMeta: (agentId: string) => mocks.agentMap[agentId] || {},
  useAgentValue: (
    agentId: string,
    selector: (agent?: { name?: string; slug?: string; title?: string }) => unknown,
  ) => selector(mocks.agentMap[agentId]),
}));

const setup = () => {
  const onSaved = vi.fn();
  const view = renderHook(() => useAgentIdentityForm({ agentId: 'agent-a', onSaved }));
  return { onSaved, ...view };
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.agentMap = { 'agent-a': { name: 'Alice', slug: 'old-slug', title: 'Health Assistant' } };
  mocks.updateAgentSlug.mockResolvedValue({ success: true });
  mocks.updateAgentMetaById.mockResolvedValue(undefined);
});

describe('useAgentIdentityForm', () => {
  it('seeds every field from the agent it edits', () => {
    const { result } = setup();

    expect(result.current.name).toBe('Alice');
    expect(result.current.title).toBe('Health Assistant');
    expect(result.current.slug).toBe('old-slug');
  });

  it('saves name and role through the meta patch, leaving an unchanged slug alone', async () => {
    const { result, onSaved } = setup();

    act(() => result.current.setName('小艾'));
    await act(async () => {
      await result.current.save();
    });

    expect(mocks.updateAgentMetaById).toHaveBeenCalledExactlyOnceWith('agent-a', {
      name: '小艾',
      title: 'Health Assistant',
    });
    expect(mocks.updateAgentSlug).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalled();
  });

  // The sidebar keeps its own copy of the label; without a refresh the list
  // shows the old name while the profile shows the new one.
  it('refreshes the sidebar list after a rename', async () => {
    const { result } = setup();

    act(() => result.current.setName('小艾'));
    await act(async () => {
      await result.current.save();
    });

    expect(mocks.refreshAgentList).toHaveBeenCalledOnce();
  });

  it('does not refresh the sidebar when the save was rejected', async () => {
    mocks.updateAgentSlug.mockResolvedValue({ reason: 'taken', success: false });
    const { result } = setup();

    act(() => result.current.setSlug('taken-slug'));
    await act(async () => {
      await result.current.save();
    });

    expect(mocks.refreshAgentList).not.toHaveBeenCalled();
  });

  it('routes a slug change to its own endpoint, normalized to lowercase', async () => {
    const { result, onSaved } = setup();

    act(() => result.current.setSlug('New-Slug'));
    await act(async () => {
      await result.current.save();
    });

    expect(mocks.updateAgentSlug).toHaveBeenCalledExactlyOnceWith('agent-a', 'new-slug');
    expect(mocks.refreshAgentConfig).toHaveBeenCalledWith('agent-a');
    expect(onSaved).toHaveBeenCalled();
  });

  it('keeps the form open with a reason when the slug is rejected', async () => {
    mocks.updateAgentSlug.mockResolvedValue({ reason: 'taken', success: false });
    const { result, onSaved } = setup();

    act(() => result.current.setSlug('taken-slug'));
    await act(async () => {
      await result.current.save();
    });

    expect(result.current.error).toBe('settingAgent.slug.error.taken');
    // A rejected slug must not leave name/role persisted behind a closed form.
    expect(mocks.updateAgentMetaById).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  describe('builtin agents', () => {
    beforeEach(() => {
      mocks.agentMap = { 'agent-a': { slug: 'inbox', title: 'Lobe AI' } };
    });

    it('locks the slug of a builtin agent', () => {
      const { result } = setup();

      expect(result.current.slugLocked).toBe(true);
    });

    it('leaves an ordinary agent unlocked', () => {
      mocks.agentMap = { 'agent-a': { slug: 'my-agent', title: 'Agent' } };
      const { result } = setup();

      expect(result.current.slugLocked).toBe(false);
    });

    // The lock is what the user sees, but the field could still be driven (a
    // stale render, a paste before the disabled prop lands) — an edit must never
    // reach the endpoint, or the builtin lookup would resolve to nothing and
    // mint a second, empty inbox.
    it('never sends a slug change for a builtin agent', async () => {
      const { result, onSaved } = setup();

      act(() => result.current.setSlug('my-inbox'));
      await act(async () => {
        await result.current.save();
      });

      expect(mocks.updateAgentSlug).not.toHaveBeenCalled();
      expect(mocks.updateAgentMetaById).toHaveBeenCalledExactlyOnceWith('agent-a', {
        name: '',
        title: 'Lobe AI',
      });
      expect(onSaved).toHaveBeenCalled();
    });
  });

  it('clears a stale error as soon as the slug is edited again', async () => {
    mocks.updateAgentSlug.mockResolvedValue({ reason: 'taken', success: false });
    const { result } = setup();

    act(() => result.current.setSlug('taken-slug'));
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.error).toBeDefined();

    act(() => result.current.setSlug('another-slug'));

    expect(result.current.error).toBeUndefined();
  });
});
