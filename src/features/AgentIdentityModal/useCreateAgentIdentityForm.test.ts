import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_AVATAR_SIZE, useCreateAgentIdentityForm } from './useCreateAgentIdentityForm';

const mocks = vi.hoisted(() => ({
  confirmAgentSlug: vi.fn(),
  createAgent: vi.fn(),
  refreshAgentConfig: vi.fn(),
  refreshAgentList: vi.fn(),
  updateAgentMeta: vi.fn(),
  updateAgentSlug: vi.fn(),
  uploadWithProgress: vi.fn(),
}));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  randomAgentName: () => '小朵',
}));

vi.mock('@/store/home', () => {
  const state = () => ({
    refreshAgentList: mocks.refreshAgentList,
    updateAgentMeta: mocks.updateAgentMeta,
  });
  const useHomeStore = (selector: (s: unknown) => unknown) => selector(state());
  useHomeStore.getState = state;
  return { useHomeStore };
});

vi.mock('@/store/home/selectors', () => ({
  homeAgentListSelectors: { allAgents: () => [] },
}));

vi.mock('@/store/global', () => ({ useGlobalStore: { getState: () => ({}) } }));
vi.mock('@/store/global/selectors', () => ({
  globalGeneralSelectors: { currentLanguage: () => 'zh-CN' },
}));

vi.mock('@/store/file', () => ({
  useFileStore: (selector: (s: unknown) => unknown) =>
    selector({ uploadWithProgress: mocks.uploadWithProgress }),
}));

vi.mock('@/services/agent', () => ({
  agentService: {
    updateAgentSlug: (...args: unknown[]) => mocks.updateAgentSlug(...args),
  },
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (s: unknown) => unknown) =>
    selector({
      createAgent: mocks.createAgent,
      internal_confirmAgentSlug: mocks.confirmAgentSlug,
      internal_refreshAgentConfig: mocks.refreshAgentConfig,
    }),
}));

const setup = (options: { groupId?: string; visibility?: 'private' | 'public' } = {}) => {
  const onCreated = vi.fn();
  const view = renderHook(() => useCreateAgentIdentityForm({ ...options, onCreated }));
  return { onCreated, ...view };
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createAgent.mockResolvedValue({ agentId: 'agent-new' });
  mocks.updateAgentSlug.mockResolvedValue({ success: true });
});

describe('useCreateAgentIdentityForm', () => {
  it('starts with a drawn name so the agent never lands nameless', () => {
    const { result } = setup();

    expect(result.current.name).toBe('小朵');
    expect(result.current.slug).toBe('');
  });

  it('creates the agent with the whole identity and hands back its id', async () => {
    const { result, onCreated } = setup({ groupId: 'grp', visibility: 'private' });

    act(() => {
      result.current.setAvatar('🦊');
      result.current.setTitle(' Health Assistant ');
      result.current.setDescription('Tracks sleep\n');
    });
    await act(async () => {
      await result.current.submit();
    });

    expect(mocks.createAgent).toHaveBeenCalledExactlyOnceWith({
      config: {
        avatar: '🦊',
        description: 'Tracks sleep',
        name: '小朵',
        title: 'Health Assistant',
      },
      groupId: 'grp',
      visibility: 'private',
    });
    // An empty slug is left to the server to generate.
    expect(mocks.updateAgentSlug).not.toHaveBeenCalled();
    expect(mocks.refreshAgentList).toHaveBeenCalled();
    expect(onCreated).toHaveBeenCalledExactlyOnceWith('agent-new');
  });

  it('applies a custom slug to the created agent, normalized to lowercase', async () => {
    const { result, onCreated } = setup();

    act(() => result.current.setSlug('My-Agent'));
    await act(async () => {
      await result.current.submit();
    });

    expect(mocks.updateAgentSlug).toHaveBeenCalledExactlyOnceWith('agent-new', 'my-agent');
    expect(mocks.confirmAgentSlug).toHaveBeenCalledWith('agent-new', 'my-agent', {
      scope: expect.any(String),
    });
    expect(mocks.refreshAgentConfig).toHaveBeenCalledWith('agent-new');
    expect(onCreated).toHaveBeenCalledWith('agent-new');
  });

  it('keeps the form open on a rejected slug and does not create a second agent on retry', async () => {
    mocks.updateAgentSlug.mockResolvedValueOnce({ reason: 'taken', success: false });
    const { result, onCreated } = setup();

    act(() => result.current.setSlug('taken'));
    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.error).toBe('settingAgent.slug.error.taken');
    expect(onCreated).not.toHaveBeenCalled();

    act(() => {
      result.current.setSlug('free');
      result.current.setName('小艾');
    });
    expect(result.current.error).toBeUndefined();
    await act(async () => {
      await result.current.submit();
    });

    expect(mocks.createAgent).toHaveBeenCalledOnce();
    expect(mocks.updateAgentMeta).toHaveBeenCalledExactlyOnceWith('agent-new', {
      avatar: null,
      description: '',
      name: '小艾',
      title: '',
    });
    expect(mocks.updateAgentSlug).toHaveBeenLastCalledWith('agent-new', 'free');
    expect(onCreated).toHaveBeenCalledExactlyOnceWith('agent-new');
  });

  it('shows a reason instead of closing when the create fails', async () => {
    mocks.createAgent.mockRejectedValueOnce(new Error('boom'));
    const { result, onCreated } = setup();

    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.error).toBe('settingAgent.identity.createFailed');
    expect(result.current.saving).toBe(false);
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('uses the uploaded image as the avatar', async () => {
    mocks.uploadWithProgress.mockResolvedValue({ url: 'https://cdn/avatar.png' });
    const { result } = setup();

    await act(async () => {
      await result.current.uploadAvatar(new File(['x'], 'a.png', { type: 'image/png' }));
    });

    expect(result.current.avatar).toBe('https://cdn/avatar.png');
    expect(result.current.uploading).toBe(false);
  });

  it('refuses an image over the upload limit without uploading it', async () => {
    const { result } = setup();
    const file = new File([new Uint8Array(MAX_AVATAR_SIZE + 1)], 'big.png');

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.uploadAvatar(file);
    });

    expect(outcome).toBe('tooLarge');
    expect(mocks.uploadWithProgress).not.toHaveBeenCalled();
    expect(result.current.avatar).toBeUndefined();
  });
});
