import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAgent: vi.fn(),
  ensureAgentMarketSkills: vi.fn(),
  ensureAgentMarketSkillsAndWarn: vi.fn(),
  getAgentByForkedFromIdentifier: vi.fn(),
  getAgentConfigById: vi.fn(),
  getAssistantDetail: vi.fn(),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => 'ws_1',
}));
vi.mock('@/services/agent', () => ({
  agentService: {
    getAgentByForkedFromIdentifier: mocks.getAgentByForkedFromIdentifier,
    getAgentConfigById: mocks.getAgentConfigById,
  },
}));
vi.mock('@/services/discover', () => ({
  discoverService: { getAssistantDetail: mocks.getAssistantDetail },
}));
vi.mock('@/services/ensureAgentMarketSkills', () => ({
  ensureAgentMarketSkills: mocks.ensureAgentMarketSkills,
  ensureAgentMarketSkillsAndWarn: mocks.ensureAgentMarketSkillsAndWarn,
}));
vi.mock('@/store/agent', () => ({
  useAgentStore: { getState: () => ({ createAgent: mocks.createAgent }) },
}));

const {
  MarketMentionInstallError,
  installMarketMentions,
  prepareMentionedMarketAgent,
  prepareMentionedMarketSkill,
} = await import('./mentionMarketInstall');

const detail = {
  avatar: '🎯',
  config: { plugins: ['okr-skill'], systemRole: 'You are an OKR coach' },
  description: 'Writes OKRs',
  title: 'OKR 教练',
};

describe('installMarketMentions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAssistantDetail.mockResolvedValue(detail);
    mocks.createAgent.mockResolvedValue({ agentId: 'agt_hidden' });
  });

  it('readies a Market agent when its chip is picked, so the send reuses that work', async () => {
    mocks.getAgentByForkedFromIdentifier.mockResolvedValue(null);
    let finishSkills!: () => void;
    mocks.ensureAgentMarketSkillsAndWarn.mockReturnValue(
      new Promise<void>((resolve) => {
        finishSkills = resolve;
      }),
    );

    prepareMentionedMarketAgent('picked-early', 'public');
    await vi.waitFor(() => expect(mocks.createAgent).toHaveBeenCalledTimes(1));
    expect(mocks.ensureAgentMarketSkillsAndWarn).toHaveBeenCalledWith(['okr-skill']);

    const sending = installMarketMentions({
      agents: [{ identifier: 'picked-early', label: 'OKR 教练', visibility: 'public' }],
      skills: [],
    });
    finishSkills();

    expect((await sending).get('picked-early')).toBe('agt_hidden');
    expect(mocks.createAgent).toHaveBeenCalledTimes(1);
    expect(mocks.ensureAgentMarketSkillsAndWarn).toHaveBeenCalledTimes(1);
  });

  it('runs a mentioned Market agent from a hidden copy instead of installing it', async () => {
    mocks.getAgentByForkedFromIdentifier.mockResolvedValue(null);

    const installed = await installMarketMentions({
      agents: [{ identifier: 'okr-coach', label: 'OKR 教练', visibility: 'public' }],
      skills: [],
    });

    expect(installed.get('okr-coach')).toBe('agt_hidden');
    expect(mocks.getAgentByForkedFromIdentifier).toHaveBeenCalledWith('okr-coach', {
      virtual: true,
    });
    const { config, visibility } = mocks.createAgent.mock.calls[0][0];
    expect(config).toMatchObject({
      // Labelled as the Market expert, never with a drawn personal name.
      name: 'OKR 教练',
      params: { forkedFromIdentifier: 'okr-coach' },
      systemRole: 'You are an OKR coach',
      title: 'OKR 教练',
      virtual: true,
    });
    expect(config.marketIdentifier).toBeUndefined();
    expect(visibility).toBe('public');
    expect(mocks.ensureAgentMarketSkillsAndWarn).toHaveBeenCalledWith(['okr-skill']);
  });

  it('installs a picked Market skill right away, so the send reuses that install', async () => {
    let finish!: () => void;
    mocks.ensureAgentMarketSkills.mockReturnValue(
      new Promise((resolve) => {
        finish = () => resolve([{ identifier: 'big-skill', status: 'installed' }]);
      }),
    );

    prepareMentionedMarketSkill('big-skill');
    expect(mocks.ensureAgentMarketSkills).toHaveBeenCalledWith(['big-skill']);

    const sending = installMarketMentions({
      agents: [],
      skills: [{ identifier: 'big-skill', label: '大技能' }],
    });
    finish();

    await expect(sending).resolves.toEqual(new Map());
    expect(mocks.ensureAgentMarketSkills).toHaveBeenCalledTimes(1);
  });

  it('retries a skill whose early install failed and names it if it fails again', async () => {
    mocks.ensureAgentMarketSkills.mockResolvedValue([
      { identifier: 'flaky-skill', reason: 'download', status: 'failed' },
    ]);

    prepareMentionedMarketSkill('flaky-skill');
    await vi.waitFor(() => expect(mocks.ensureAgentMarketSkills).toHaveBeenCalledTimes(1));
    await Promise.resolve();

    const sending = installMarketMentions({
      agents: [],
      skills: [{ identifier: 'flaky-skill', label: '不稳定技能' }],
    });

    await expect(sending).rejects.toEqual(new MarketMentionInstallError(['不稳定技能']));
    expect(mocks.ensureAgentMarketSkills).toHaveBeenCalledTimes(2);
  });

  it('installs a skill again when it was removed after an earlier mention installed it', async () => {
    mocks.ensureAgentMarketSkills.mockResolvedValue([
      { identifier: 'removed-skill', status: 'installed' },
    ]);
    const request = { agents: [], skills: [{ identifier: 'removed-skill', label: '被删技能' }] };

    await installMarketMentions(request);
    // The user deleted it from the agent's tools; mentioning it again must
    // reinstall it rather than trust the earlier install.
    await installMarketMentions(request);

    expect(mocks.ensureAgentMarketSkills).toHaveBeenCalledTimes(2);
  });

  it('reuses the hidden copy an earlier mention created', async () => {
    mocks.getAgentByForkedFromIdentifier.mockResolvedValue('agt_earlier');

    const installed = await installMarketMentions({
      agents: [{ identifier: 'reused-coach', label: 'OKR 教练', visibility: 'private' }],
      skills: [],
    });

    expect(installed.get('reused-coach')).toBe('agt_earlier');
    expect(mocks.createAgent).not.toHaveBeenCalled();
  });

  it('makes sure a reused hidden copy still has the Market skills it depends on', async () => {
    // A dependency that failed to install when the copy was created must be
    // retried, or the agent keeps running without it.
    mocks.getAgentByForkedFromIdentifier.mockResolvedValue('agt_earlier');
    mocks.getAgentConfigById.mockResolvedValue({ plugins: ['okr-skill', 'lobe-web-browsing'] });

    await installMarketMentions({
      agents: [{ identifier: 'coach-with-skills', label: 'OKR 教练', visibility: 'private' }],
      skills: [],
    });

    expect(mocks.getAgentConfigById).toHaveBeenCalledWith('agt_earlier');
    expect(mocks.ensureAgentMarketSkillsAndWarn).toHaveBeenCalledWith([
      'okr-skill',
      'lobe-web-browsing',
    ]);
    expect(mocks.getAssistantDetail).not.toHaveBeenCalled();
  });
});
