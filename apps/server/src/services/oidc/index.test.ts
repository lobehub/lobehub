import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createContextForInteractionDetails } from '@/libs/oidc-provider/http-adapter';

import { OIDCService } from '.';
import { getOIDCProvider } from './oidcProvider';

vi.mock('@/libs/oidc-provider/http-adapter', () => ({
  createContextForInteractionDetails: vi.fn(),
}));

vi.mock('./oidcProvider', () => ({
  getOIDCProvider: vi.fn(),
}));

const createMockProvider = () => {
  const grantCtor = Object.assign(
    vi.fn().mockImplementation((payload) => ({
      ...payload,
      destroy: vi.fn(),
    })),
    { find: vi.fn() },
  );

  return {
    interactionDetails: vi.fn(),
    interactionResult: vi.fn(),
    interactionFinished: vi.fn(),
    Grant: grantCtor,
    Client: {
      find: vi.fn(),
    },
  };
};

describe('OIDCService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initialize should resolve provider and return a working service', async () => {
    const provider = createMockProvider();
    provider.Client.find.mockResolvedValue({ metadata: () => ({ scope: 'openid' }) });
    vi.mocked(getOIDCProvider).mockResolvedValue(provider as any);

    const service = await OIDCService.initialize();
    await service.getClientMetadata('client-1');

    expect(getOIDCProvider).toHaveBeenCalledTimes(1);
    expect(provider.Client.find).toHaveBeenCalledWith('client-1');
  });

  it('getInteractionDetails should delegate to provider with context request/response', async () => {
    const provider = createMockProvider();
    provider.interactionDetails.mockResolvedValue({ prompt: 'login' });
    vi.mocked(createContextForInteractionDetails).mockResolvedValue({
      req: { id: 'req' },
      res: { id: 'res' },
    } as any);

    const service = new OIDCService(provider as any);
    const result = await service.getInteractionDetails('uid-1');

    expect(createContextForInteractionDetails).toHaveBeenCalledWith('uid-1');
    expect(provider.interactionDetails).toHaveBeenCalledWith({ id: 'req' }, { id: 'res' });
    expect(result).toEqual({ prompt: 'login' });
  });

  it('getInteractionResult should return provider interaction result', async () => {
    const provider = createMockProvider();
    provider.interactionResult.mockResolvedValue({ ok: true });
    vi.mocked(createContextForInteractionDetails).mockResolvedValue({
      req: { id: 'req' },
      res: { id: 'res' },
    } as any);

    const service = new OIDCService(provider as any);
    const payload = { login: true };
    const result = await service.getInteractionResult('uid-2', payload);

    expect(provider.interactionResult).toHaveBeenCalledWith({ id: 'req' }, { id: 'res' }, payload);
    expect(result).toEqual({ ok: true });
  });

  it('finishInteraction should call provider with merge option', async () => {
    const provider = createMockProvider();
    provider.interactionFinished.mockResolvedValue(undefined);
    vi.mocked(createContextForInteractionDetails).mockResolvedValue({
      req: { id: 'req' },
      res: { id: 'res' },
    } as any);

    const service = new OIDCService(provider as any);
    const payload = { consent: true };
    await service.finishInteraction('uid-3', payload);

    expect(provider.interactionFinished).toHaveBeenCalledWith(
      { id: 'req' },
      { id: 'res' },
      payload,
      { mergeWithLastSubmission: true },
    );
  });

  it('findOrCreateGrants should reuse existing matching grant', async () => {
    const provider = createMockProvider();
    const existingGrant = { accountId: 'account-1', clientId: 'client-1' };
    provider.Grant.find.mockResolvedValue(existingGrant as any);

    const service = new OIDCService(provider as any);
    const grant = await service.findOrCreateGrants('account-1', 'client-1', 'grant-1');

    expect(provider.Grant.find).toHaveBeenCalledWith('grant-1');
    expect(provider.Grant).not.toHaveBeenCalled();
    expect(grant).toBe(existingGrant);
  });

  it('findOrCreateGrants should destroy mismatched grant and create a new one', async () => {
    const provider = createMockProvider();
    const staleGrant = {
      accountId: 'other-account',
      clientId: 'client-1',
      destroy: vi.fn().mockResolvedValue(undefined),
    };
    provider.Grant.find.mockResolvedValue(staleGrant as any);

    const createdGrant = { accountId: 'account-2', clientId: 'client-1' };
    provider.Grant.mockImplementation(() => createdGrant as any);

    const service = new OIDCService(provider as any);
    const grant = await service.findOrCreateGrants('account-2', 'client-1', 'grant-2');

    expect(staleGrant.destroy).toHaveBeenCalledTimes(1);
    expect(provider.Grant).toHaveBeenCalledWith({ accountId: 'account-2', clientId: 'client-1' });
    expect(grant).toBe(createdGrant);
  });

  it('findOrCreateGrants should create new grant when no existing id is provided', async () => {
    const provider = createMockProvider();
    const createdGrant = { accountId: 'account-3', clientId: 'client-3' };
    provider.Grant.mockImplementation(() => createdGrant as any);

    const service = new OIDCService(provider as any);
    const grant = await service.findOrCreateGrants('account-3', 'client-3');

    expect(provider.Grant.find).not.toHaveBeenCalled();
    expect(provider.Grant).toHaveBeenCalledWith({ accountId: 'account-3', clientId: 'client-3' });
    expect(grant).toBe(createdGrant);
  });

  it('findOrCreateGrants should create new grant if provided id is missing in storage', async () => {
    const provider = createMockProvider();
    provider.Grant.find.mockResolvedValue(undefined);
    const createdGrant = { accountId: 'account-4', clientId: 'client-4' };
    provider.Grant.mockImplementation(() => createdGrant as any);

    const service = new OIDCService(provider as any);
    const grant = await service.findOrCreateGrants('account-4', 'client-4', 'grant-missing');

    expect(provider.Grant.find).toHaveBeenCalledWith('grant-missing');
    expect(provider.Grant).toHaveBeenCalledWith({ accountId: 'account-4', clientId: 'client-4' });
    expect(grant).toBe(createdGrant);
  });

  it('findOrCreateGrants should recreate grant if client mismatch occurs', async () => {
    const provider = createMockProvider();
    const staleGrant = {
      accountId: 'account-5',
      clientId: 'other-client',
      destroy: vi.fn().mockResolvedValue(undefined),
    };
    provider.Grant.find.mockResolvedValue(staleGrant as any);

    const createdGrant = { accountId: 'account-5', clientId: 'client-5' };
    provider.Grant.mockImplementation(() => createdGrant as any);

    const service = new OIDCService(provider as any);
    const grant = await service.findOrCreateGrants(
      'account-5',
      'client-5',
      'grant-client-mismatch',
    );

    expect(staleGrant.destroy).toHaveBeenCalledTimes(1);
    expect(provider.Grant).toHaveBeenCalledWith({ accountId: 'account-5', clientId: 'client-5' });
    expect(grant).toBe(createdGrant);
  });

  it('findOrCreateGrants should continue when destroy throws during mismatch cleanup', async () => {
    const provider = createMockProvider();
    const staleGrant = {
      accountId: 'wrong-account',
      clientId: 'client-6',
      destroy: vi.fn().mockRejectedValue(new Error('destroy failed')),
    };
    provider.Grant.find.mockResolvedValue(staleGrant as any);

    const createdGrant = { accountId: 'account-6', clientId: 'client-6' };
    provider.Grant.mockImplementation(() => createdGrant as any);

    const service = new OIDCService(provider as any);
    const grant = await service.findOrCreateGrants('account-6', 'client-6', 'grant-error');

    expect(staleGrant.destroy).toHaveBeenCalledTimes(1);
    expect(provider.Grant).toHaveBeenCalledWith({ accountId: 'account-6', clientId: 'client-6' });
    expect(grant).toBe(createdGrant);
  });

  it('getClientMetadata should return metadata from client lookup', async () => {
    const provider = createMockProvider();
    provider.Client.find.mockResolvedValue({
      metadata: () => ({ redirect_uris: ['https://example.com/cb'] }),
    });

    const service = new OIDCService(provider as any);
    const metadata = await service.getClientMetadata('client-5');

    expect(provider.Client.find).toHaveBeenCalledWith('client-5');
    expect(metadata).toEqual({ redirect_uris: ['https://example.com/cb'] });
  });

  it('getClientMetadata should return undefined when client is missing', async () => {
    const provider = createMockProvider();
    provider.Client.find.mockResolvedValue(undefined);

    const service = new OIDCService(provider as any);
    const metadata = await service.getClientMetadata('client-missing');

    expect(provider.Client.find).toHaveBeenCalledWith('client-missing');
    expect(metadata).toBeUndefined();
  });
});
