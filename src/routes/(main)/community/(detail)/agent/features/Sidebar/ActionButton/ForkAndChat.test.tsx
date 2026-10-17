/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type * as I18nextModule from 'i18next';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agentService } from '@/services/agent';
import { marketApiService } from '@/services/marketApi';
import { agentSkillService } from '@/services/skill';
import { useToolStore } from '@/store/tool';

import ForkAndChat from './ForkAndChat';

const mocks = vi.hoisted(() => ({
  createAgent: vi.fn(),
  navigate: vi.fn(),
  refreshAgentList: vi.fn(),
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof I18nextModule>()),
  t: (key: string, options?: { skills?: string }) => `${key}: ${options?.skills}`,
}));
vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  createStaticStyles: () => ({}),
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Select: () => null,
  toast: mocks.toast,
}));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => null,
  useActiveWorkspaceId: () => null,
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));
vi.mock('@/layout/AuthProvider/MarketAuth', () => ({
  useMarketAuth: () => ({ isAuthenticated: true, signIn: vi.fn() }),
}));
vi.mock('@/services/discover', () => ({ discoverService: { reportAgentEvent: vi.fn() } }));
vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (s: object) => unknown) => selector({ createAgent: mocks.createAgent }),
}));
vi.mock('@/store/home', () => ({
  useHomeStore: (selector: (s: object) => unknown) =>
    selector({ refreshAgentList: mocks.refreshAgentList }),
}));
vi.mock('../../DetailProvider', () => ({
  useDetailContext: () => ({
    config: { params: {}, plugins: ['skill-a', { identifier: 'skill-b', mode: 'disabled' }] },
    identifier: 'source-agent',
    title: 'Source Agent',
  }),
}));

describe('ForkAndChat market skills', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.values(mocks.toast).forEach((fn) => fn.mockReset());
    mocks.navigate.mockReset();
    mocks.createAgent.mockReset().mockResolvedValue({ agentId: 'new-agent' });
    mocks.refreshAgentList.mockReset().mockResolvedValue(undefined);
    vi.spyOn(agentService, 'getAgentByForkedFromIdentifier').mockResolvedValue(null);
    vi.spyOn(marketApiService, 'forkAgent').mockResolvedValue([
      { data: { agent: { identifier: 'forked', name: 'Forked' } }, success: true },
    ] as any);
    vi.spyOn(useToolStore, 'getState').mockReturnValue({
      ...useToolStore.getState(),
      refreshAgentSkills: vi.fn().mockResolvedValue(undefined),
    });
  });

  const fork = async () => {
    render(<ForkAndChat />);
    fireEvent.click(screen.getByText('fork.forkAndChat'));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
  };

  it('installs the referenced skills after creating the agent, without warning on success', async () => {
    const ensure = vi.spyOn(agentSkillService, 'ensureFromMarket').mockResolvedValue([
      { identifier: 'skill-a', status: 'installed' },
      { identifier: 'skill-b', status: 'notSkill' },
    ]);

    await fork();

    expect(ensure).toHaveBeenCalledWith(['skill-a', 'skill-b']);
    expect(ensure.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.createAgent.mock.invocationCallOrder[0],
    );
    expect(mocks.toast.warning).not.toHaveBeenCalled();
    expect(mocks.toast.success).toHaveBeenCalledWith('fork.success');
  });

  it('still reports success and navigates when installing skills fails outright', async () => {
    vi.spyOn(agentSkillService, 'ensureFromMarket').mockRejectedValue(new Error('network down'));

    await fork();

    expect(mocks.navigate).toHaveBeenCalledWith(expect.stringContaining('new-agent'));
    expect(mocks.toast.success).toHaveBeenCalledWith('fork.success');
    expect(mocks.toast.error).not.toHaveBeenCalled();
    expect(mocks.toast.warning).toHaveBeenCalledTimes(1);
    expect(mocks.toast.warning.mock.calls[0][0]).toContain('skill-a');
  });

  it('warns only about failed skills, not about notSkill ones', async () => {
    vi.spyOn(agentSkillService, 'ensureFromMarket').mockResolvedValue([
      { identifier: 'skill-a', reason: 'download', status: 'failed' },
      { identifier: 'skill-b', status: 'notSkill' },
    ]);

    await fork();

    expect(mocks.toast.warning).toHaveBeenCalledTimes(1);
    const message = mocks.toast.warning.mock.calls[0][0] as string;
    expect(message).toContain('skill-a');
    expect(message).not.toContain('skill-b');
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });
});
