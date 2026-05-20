import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';

import { messengerService } from './messenger';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    messenger: {
      availablePlatforms: { query: vi.fn() },
      confirmLink: { mutate: vi.fn() },
      getMyLink: { query: vi.fn() },
      listAgentsForBinding: { query: vi.fn() },
      listMyInstallations: { query: vi.fn() },
      listMyLinks: { query: vi.fn() },
      peekLinkToken: { query: vi.fn() },
      setActiveAgent: { mutate: vi.fn() },
      uninstallInstallation: { mutate: vi.fn() },
      unlink: { mutate: vi.fn() },
    },
  },
}));

const messenger = (lambdaClient as any).messenger;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('messengerService', () => {
  it('availablePlatforms delegates to lambdaClient query', async () => {
    messenger.availablePlatforms.query.mockResolvedValueOnce([{ id: 'slack' }]);
    const result = await messengerService.availablePlatforms();
    expect(result).toEqual([{ id: 'slack' }]);
    expect(messenger.availablePlatforms.query).toHaveBeenCalledTimes(1);
  });

  it('peekLinkToken passes through the random id', async () => {
    messenger.peekLinkToken.query.mockResolvedValueOnce({ platform: 'slack' });
    await messengerService.peekLinkToken('rand-1');
    expect(messenger.peekLinkToken.query).toHaveBeenCalledWith({ randomId: 'rand-1' });
  });

  it('listAgentsForBinding delegates to query', async () => {
    messenger.listAgentsForBinding.query.mockResolvedValueOnce([]);
    await messengerService.listAgentsForBinding();
    expect(messenger.listAgentsForBinding.query).toHaveBeenCalledTimes(1);
  });

  it('confirmLink forwards mutate params verbatim', async () => {
    messenger.confirmLink.mutate.mockResolvedValueOnce({ ok: true });
    await messengerService.confirmLink({ initialAgentId: 'agt_1', randomId: 'rand-1' });
    expect(messenger.confirmLink.mutate).toHaveBeenCalledWith({
      initialAgentId: 'agt_1',
      randomId: 'rand-1',
    });
  });

  it('getMyLink forwards platform + tenantId', async () => {
    await messengerService.getMyLink('slack', 'T_ACME');
    expect(messenger.getMyLink.query).toHaveBeenCalledWith({
      platform: 'slack',
      tenantId: 'T_ACME',
    });
  });

  it('getMyLink works without a tenantId (global-bot platforms)', async () => {
    await messengerService.getMyLink('telegram');
    expect(messenger.getMyLink.query).toHaveBeenCalledWith({
      platform: 'telegram',
      tenantId: undefined,
    });
  });

  it('listMyLinks delegates to query', async () => {
    await messengerService.listMyLinks();
    expect(messenger.listMyLinks.query).toHaveBeenCalledTimes(1);
  });

  it('setActiveAgent forwards mutate params', async () => {
    await messengerService.setActiveAgent({
      agentId: 'agt_2',
      platform: 'slack',
      tenantId: 'T_ACME',
    });
    expect(messenger.setActiveAgent.mutate).toHaveBeenCalledWith({
      agentId: 'agt_2',
      platform: 'slack',
      tenantId: 'T_ACME',
    });
  });

  it('setActiveAgent supports clearing the active agent (agentId=null)', async () => {
    await messengerService.setActiveAgent({ agentId: null, platform: 'discord' });
    expect(messenger.setActiveAgent.mutate).toHaveBeenCalledWith({
      agentId: null,
      platform: 'discord',
      tenantId: undefined,
    });
  });

  it('unlink forwards mutate params', async () => {
    await messengerService.unlink({ platform: 'slack', tenantId: 'T_ACME' });
    expect(messenger.unlink.mutate).toHaveBeenCalledWith({
      platform: 'slack',
      tenantId: 'T_ACME',
    });
  });

  it('listMyInstallations delegates to query', async () => {
    await messengerService.listMyInstallations();
    expect(messenger.listMyInstallations.query).toHaveBeenCalledTimes(1);
  });

  it('uninstallInstallation forwards installationId', async () => {
    await messengerService.uninstallInstallation({ installationId: 'inst_1' });
    expect(messenger.uninstallInstallation.mutate).toHaveBeenCalledWith({
      installationId: 'inst_1',
    });
  });
});
