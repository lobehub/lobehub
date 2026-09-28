import { confirmModal, toast } from '@lobehub/ui/base-ui';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentMarketSubmission } from './useAgentMarketSubmission';

const mocks = vi.hoisted(() => ({
  authenticated: true,
  close: vi.fn(),
  config: {
    chatConfig: { historyCount: 7, runtimeEnv: { workingDirectory: '/private' } },
    model: 'test-model',
    params: { temperature: 0.3, top_p: 0.8 },
    plugins: ['search', { identifier: 'disabled-tool', mode: 'disabled' }],
    provider: 'test-provider',
    systemRole: 'Older saved prompt',
  },
  meta: { marketIdentifier: undefined as string | undefined, title: 'Review agent' },
  signIn: vi.fn(),
  state: { activeAgentId: 'agent-a', updateAgentMetaById: vi.fn() },
  submit: vi.fn(),
  workspace: false,
  workspaceIdentity: vi.fn(),
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  confirmModal: vi.fn(() => ({ close: mocks.close, destroy: vi.fn() })),
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));
vi.mock('@/business/client/hooks/useHasActiveWorkspace', () => ({
  useHasActiveWorkspace: () => mocks.workspace,
}));
vi.mock('@/layout/AuthProvider/MarketAuth', () => ({
  useMarketAuth: () => ({ isAuthenticated: mocks.authenticated, signIn: mocks.signIn }),
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    market: { agent: { publishOrCreate: { mutate: mocks.submit } } },
    workspace: { ensureMarketOrganization: { mutate: mocks.workspaceIdentity } },
  },
}));
vi.mock('@/store/agent', () => ({ useAgentStore: { getState: () => mocks.state } }));
vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    getAgentConfigById: () => () => mocks.config,
    getAgentMetaById: () => () => mocks.meta,
  },
}));

const getPrompt = () => ({ editorData: { text: 'Current draft' }, systemRole: 'Current draft' });
const confirmation = () => vi.mocked(confirmModal).mock.calls.at(-1)![0];
const renderSubmission = (canSubmit = true) =>
  renderHook(() => useAgentMarketSubmission({ agentId: 'agent-a', canSubmit, getPrompt }));

describe('Market review submission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticated = true;
    mocks.workspace = false;
    mocks.state.activeAgentId = 'agent-a';
    mocks.meta.marketIdentifier = undefined;
    mocks.submit.mockResolvedValue({ identifier: 'market-a', isNewAgent: true, success: true });
    mocks.state.updateAgentMetaById.mockResolvedValue(undefined);
    mocks.workspaceIdentity.mockResolvedValue({ marketAccountId: 42 });
  });

  it('requires confirmation and submits the current draft, excluding disabled tools and private runtime settings', async () => {
    const { result } = renderSubmission();
    await act(() => result.current.open());
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(result.current.isUnderReview).toBe(false);
    await act(async () => confirmation().onOk?.());
    expect(mocks.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        config: {
          chatConfig: expect.objectContaining({ historyCount: 7, temperature: 0.3, topP: 0.8 }),
          description: undefined,
          locale: expect.any(String),
          model: {
            model: 'test-model',
            parameters: { temperature: 0.3, top_p: 0.8 },
            provider: 'test-provider',
          },
          plugins: ['search'],
          systemRole: 'Current draft',
        },
        editorData: { text: 'Current draft' },
        name: 'Review agent',
      }),
    );
    expect(JSON.stringify(mocks.submit.mock.calls[0])).not.toContain('/private');
    expect(mocks.state.updateAgentMetaById).toHaveBeenCalledWith('agent-a', {
      marketIdentifier: 'market-a',
    });
    expect(toast.success).toHaveBeenCalledWith('marketSubmission.success');
    expect(result.current.revision).toBe(1);
    expect(result.current.isUnderReview).toBe(true);
  });

  it('does not show another agent as under review after navigating during submission', async () => {
    let resolve!: (value: { identifier: string; isNewAgent: boolean; success: boolean }) => void;
    mocks.submit.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { result, rerender } = renderHook(
      ({ agentId }) => useAgentMarketSubmission({ agentId, canSubmit: true, getPrompt }),
      { initialProps: { agentId: 'agent-a' } },
    );
    await act(() => result.current.open());
    let pending: void | Promise<void>;
    act(() => {
      pending = confirmation().onOk?.();
    });
    expect(result.current.isUnderReview).toBe(false);
    mocks.state.activeAgentId = 'agent-b';
    rerender({ agentId: 'agent-b' });
    await act(async () => {
      resolve({ identifier: 'market-a', isNewAgent: true, success: true });
      await pending;
    });
    expect(result.current.isUnderReview).toBe(false);
  });

  it('submits existing listings as new versions under the workspace identity', async () => {
    mocks.workspace = true;
    mocks.workspaceIdentity.mockImplementation(async (input) => {
      if (!input?.autoProvision) throw new Error('Community profile setup required');
      return { marketAccountId: 42 };
    });
    mocks.meta.marketIdentifier = 'existing';
    mocks.submit.mockResolvedValue({ identifier: 'existing', isNewAgent: false, success: true });
    const { result } = renderSubmission();
    await act(() => result.current.open());
    await act(async () => confirmation().onOk?.());
    expect(mocks.submit).toHaveBeenCalledWith(
      expect.objectContaining({ actAs: 42, identifier: 'existing' }),
    );
    expect(mocks.state.updateAgentMetaById).not.toHaveBeenCalled();
    expect(result.current.revision).toBe(1);
  });

  it('does not authorize or submit when access is denied', async () => {
    const { result } = renderSubmission(false);
    await act(() => result.current.open());
    expect(confirmModal).not.toHaveBeenCalled();
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('stops when Market authorization is cancelled', async () => {
    mocks.authenticated = false;
    mocks.signIn.mockRejectedValueOnce(new Error('User cancelled authorization'));
    const { result } = renderSubmission();
    await act(() => result.current.open());
    expect(mocks.signIn).toHaveBeenCalledOnce();
    expect(confirmModal).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();

    mocks.signIn.mockResolvedValueOnce(true);
    await act(() => result.current.open());
    expect(confirmModal).toHaveBeenCalledOnce();
  });

  it('reports real authorization failures without submitting', async () => {
    mocks.authenticated = false;
    mocks.signIn.mockRejectedValueOnce(new Error('Authorization state mismatch'));
    const { result } = renderSubmission();
    await act(() => result.current.open());
    expect(toast.error).toHaveBeenCalledWith('marketSubmission.failed');
    expect(confirmModal).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('does not fall back to personal submission when workspace provisioning fails', async () => {
    mocks.workspace = true;
    mocks.workspaceIdentity.mockRejectedValueOnce(new Error('Provisioning failed'));
    const { result } = renderSubmission();
    await act(() => result.current.open());
    await act(async () => {
      await expect(confirmation().onOk?.()).rejects.toThrow('Provisioning failed');
    });
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(result.current.isUnderReview).toBe(false);
    expect(result.current.isSubmitting).toBe(false);

    await act(async () => confirmation().onOk?.());
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ actAs: 42 }));
  });

  it('keeps the originating agent ID and suppresses duplicate submissions during a route change', async () => {
    let resolve!: (value: { identifier: string; isNewAgent: boolean; success: boolean }) => void;
    mocks.submit.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { result } = renderSubmission();
    await act(() => result.current.open());
    let pending: void | Promise<void>;
    act(() => {
      pending = confirmation().onOk?.();
    });
    mocks.state.activeAgentId = 'agent-b';
    await act(async () => confirmation().onOk?.());
    expect(mocks.submit).toHaveBeenCalledOnce();
    await act(async () => {
      resolve({ identifier: 'market-a', isNewAgent: true, success: true });
      await pending;
    });
    expect(mocks.state.updateAgentMetaById).toHaveBeenCalledWith('agent-a', {
      marketIdentifier: 'market-a',
    });
  });

  it('does not report success on failure and allows retry', async () => {
    mocks.submit.mockRejectedValueOnce(new Error('Rejected'));
    const { result } = renderSubmission();
    await act(() => result.current.open());
    await act(async () => {
      await expect(confirmation().onOk?.()).rejects.toThrow('Rejected');
    });
    expect(toast.success).not.toHaveBeenCalled();
    expect(mocks.state.updateAgentMetaById).not.toHaveBeenCalled();
    expect(result.current.isSubmitting).toBe(false);
    expect(result.current.isUnderReview).toBe(false);
    await act(async () => confirmation().onOk?.());
    expect(toast.success).toHaveBeenCalledOnce();
    expect(result.current.isUnderReview).toBe(true);
  });
});
