import { ConnectorDataError } from '@lobechat/connector-data';
import type { GitHubConnectorClient } from '@lobechat/connector-data/github';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createUnderstandingProviderRegistry } from '.';
import { createGitHubUnderstandingProvider } from './github';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  formatMarkdown: vi.fn(),
}));

vi.mock('@lobechat/connector-data/github', () => ({
  createGitHubConnectorClient: mocks.createClient,
  toGitHubUserContextMarkdown: mocks.formatMarkdown,
}));
vi.mock('@/database/models/connector', () => ({ ConnectorModel: vi.fn() }));
vi.mock('@/database/schemas', () => ({ account: {} }));
vi.mock('@/libs/composio', () => ({ getComposioClient: vi.fn() }));
vi.mock('@/server/services/connector/tokens', () => ({ ensureFreshConnectorToken: vi.fn() }));

const context = { userId: 'user-1' };
const profile = { externalAccountId: '42', login: 'neko', name: 'Neko' };

describe('GitHub Understanding provider', () => {
  let client: GitHubConnectorClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = {
      getUserProfile: vi.fn().mockResolvedValue(profile),
      getUserProfileReadme: vi.fn().mockResolvedValue('Profile readme'),
      listPinnedRepositories: vi.fn().mockResolvedValue([]),
      listRecentContributions: vi.fn().mockResolvedValue([]),
      listRecentPullRequests: vi.fn().mockResolvedValue([]),
      listRecentRepositories: vi.fn().mockResolvedValue([]),
      listRepositoryContributors: vi.fn().mockResolvedValue([]),
      listUserOrganizations: vi.fn().mockResolvedValue([]),
    };
    mocks.createClient.mockReturnValue(client);
    mocks.formatMarkdown.mockReturnValue('GITHUB_MARKDOWN_SENTINEL');
  });

  it('resolves OAuth candidates on every collect and selects the strongest stable candidate', async () => {
    const queryAuthAccounts = vi.fn().mockResolvedValue([{ id: 'login', providerId: 'github' }]);
    const queryConnectors = vi.fn().mockResolvedValue([
      { id: 'integration', isEnabled: true, status: 'connected' },
      { id: 'onboarding', isEnabled: true, status: 'connected' },
    ]);
    const loadCredential = vi.fn(async ({ candidateId }) => ({
      accessToken: `token:${candidateId}`,
      scope: candidateId === 'connector:onboarding' ? 'read:user repo' : 'read:user',
    }));
    const provider = createUnderstandingProviderRegistry([
      createGitHubUnderstandingProvider({ loadCredential, queryAuthAccounts, queryConnectors }),
    ]).get('github')!;

    const result = await provider.collect(context);

    expect(queryAuthAccounts).toHaveBeenCalledOnce();
    expect(queryConnectors).toHaveBeenCalledOnce();
    expect(mocks.createClient).toHaveBeenLastCalledWith({
      accessToken: 'token:connector:onboarding',
    });
    expect(result.context).toBe('Provider: github\n\n# Source Brief\n\nGITHUB_MARKDOWN_SENTINEL');
    expect(result.sourceCount).toBe(2);
  });

  it('falls back from an unusable connector credential to GitHub login OAuth', async () => {
    const loadCredential = vi.fn(async ({ credentialOrigin }) =>
      credentialOrigin === 'auth_account'
        ? { accessToken: 'login-token', scope: 'read:user' }
        : undefined,
    );
    const provider = createUnderstandingProviderRegistry([
      createGitHubUnderstandingProvider({
        loadCredential,
        queryAuthAccounts: async () => [{ id: 'login', providerId: 'github' }],
        queryConnectors: async () => [{ id: 'connector', isEnabled: true, status: 'connected' }],
      }),
    ]).get('github')!;

    await expect(provider.collect(context)).resolves.toMatchObject({
      context: expect.stringContaining('GITHUB_MARKDOWN_SENTINEL'),
    });
    expect(mocks.createClient).toHaveBeenLastCalledWith({ accessToken: 'login-token' });
  });

  it('keeps optional connector failures as bounded diagnostics', async () => {
    client.listUserOrganizations = vi.fn().mockRejectedValue(
      new ConnectorDataError({
        code: 'private_code',
        operation: 'private_operation',
        provider: 'github',
        retryable: false,
      }),
    );
    const provider = createUnderstandingProviderRegistry([
      createGitHubUnderstandingProvider({
        loadCredential: async () => ({ accessToken: 'token' }),
        queryAuthAccounts: async () => [{ id: 'login', providerId: 'github' }],
      }),
    ]).get('github')!;

    const result = await provider.collect(context);

    expect(result.diagnostics.errors).toContainEqual({
      code: 'GITHUB_ORGANIZATIONS_FAILED',
      message: 'github organizations failed',
      operation: 'organizations',
      provider: 'github',
      retryable: false,
    });
    expect(JSON.stringify(result)).not.toContain('private_code');
  });

  it('rethrows a sanitized transient OAuth identification failure', async () => {
    client.getUserProfile = vi.fn().mockRejectedValue(
      new ConnectorDataError({
        code: 'github_request_failed',
        operation: 'getUserProfile',
        provider: 'github',
        retryable: true,
      }),
    );
    const provider = createUnderstandingProviderRegistry([
      createGitHubUnderstandingProvider({
        loadCredential: async () => ({ accessToken: 'private-token' }),
        queryAuthAccounts: async () => [{ id: 'login', providerId: 'github' }],
      }),
    ]).get('github')!;

    const error = await provider.collect(context).catch((caught) => caught);
    expect(error).toMatchObject({ name: 'UnderstandingProviderRetryableError', retryable: true });
    expect(String(error)).not.toContain('private-token');
  });
});
