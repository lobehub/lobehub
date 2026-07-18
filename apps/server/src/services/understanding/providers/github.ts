import { ConnectorDataError } from '@lobechat/connector-data';
import type { GitHubConnectorClient, GitHubUserContext } from '@lobechat/connector-data/github';
import {
  createGitHubConnectorClient,
  toGitHubUserContextMarkdown,
} from '@lobechat/connector-data/github';
import debug from 'debug';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { ConnectorModel } from '@/database/models/connector';
import { account } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { ensureFreshConnectorToken } from '@/server/services/connector/tokens';

import type {
  SourceCandidate,
  UnderstandingProvider,
  UnderstandingProviderRegistration,
} from '../types';
import { UnderstandingSourceIdentificationError } from '../types';

const log = debug('lobe-server:understanding:github');

interface GitHubProviderDependencies {
  loadCredential?: (candidate: SourceCandidate<'github'>) => Promise<unknown>;
  now?: () => number;
  queryAuthAccounts?: () => Promise<Array<{ id: string; providerId: string }>>;
  queryConnectors?: () => Promise<Array<{ id: string; isEnabled: boolean; status: string }>>;
}

interface GateKeeper {
  decrypt: (ciphertext: string) => Promise<{ plaintext: string }>;
  encrypt: (plaintext: string) => Promise<string>;
}

interface GitHubProviderContextOptions {
  db: LobeChatDatabase;
  ensureFreshConnector?: typeof ensureFreshConnectorToken;
  gateKeeper?: GateKeeper;
  userId: string;
  workspaceId?: string;
}

interface GitHubCredential {
  accessToken: string;
}

const LoadedGitHubCredentialSchema = z
  .object({
    accessToken: z.string().min(1),
    expiresAt: z.union([z.date(), z.number(), z.string()]).optional(),
    scope: z.string().optional(),
    scopes: z.array(z.string()).optional(),
  })
  .strict();
type LoadedGitHubCredential = z.infer<typeof LoadedGitHubCredentialSchema>;

const parseScopes = (...values: Array<string | string[] | undefined>) =>
  [
    ...new Set(
      values.flatMap((value) => (Array.isArray(value) ? value : (value?.split(/[ ,]+/) ?? []))),
    ),
  ]
    .map((scope) => scope.trim())
    .filter(Boolean)
    .sort();

const isExpired = (expiresAt: LoadedGitHubCredential['expiresAt'], now: number) => {
  if (!expiresAt) return false;
  const timestamp = expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
  return !Number.isFinite(timestamp) || timestamp <= now;
};

const parseCredentialReferenceId = (reference: string, prefix: string) => {
  const expectedPrefix = `${prefix}:`;
  if (!reference.startsWith(expectedPrefix)) throw new Error('Invalid credential reference');
  const id = reference.slice(expectedPrefix.length);
  if (!id) throw new Error('Invalid credential reference');
  return id;
};

interface SupplementalGitHubDiagnostic {
  code: string;
  message: string;
  operation: string;
}

interface SupplementalGitHubOperation {
  diagnostic: SupplementalGitHubDiagnostic;
  run: () => Promise<Partial<GitHubUserContext>>;
}

const collectContributorOperations = async (
  client: GitHubConnectorClient,
  pinnedRepositoriesPromise: Promise<NonNullable<GitHubUserContext['pinnedRepositories']>>,
) => {
  let repositories: NonNullable<GitHubUserContext['pinnedRepositories']>;
  try {
    repositories = await pinnedRepositoriesPromise;
  } catch {
    return { operations: [], results: [] };
  }

  const operations = repositories.map((repository): SupplementalGitHubOperation => ({
    diagnostic: {
      code: 'GITHUB_CONTRIBUTORS_FAILED',
      message: 'GitHub contributor enrichment failed',
      operation: `contributors:${repository.nameWithOwner}`,
    },
    run: async () => ({
      repositoryContributors: {
        [repository.nameWithOwner]: await client.listRepositoryContributors(
          repository.nameWithOwner,
        ),
      },
    }),
  }));

  return {
    operations,
    results: await Promise.allSettled(operations.map(({ run }) => run())),
  };
};

const collectGitHubContext = async (
  client: GitHubConnectorClient,
): Promise<{
  context: GitHubUserContext;
  errors: Array<SupplementalGitHubDiagnostic & { provider: 'github'; retryable: boolean }>;
  failedCount: number;
  succeededCount: number;
}> => {
  const pinnedRepositoriesPromise = client.listPinnedRepositories();
  const profilePromise = client.getUserProfile();
  const handleProfileError = (error: unknown) => {
    const errorName =
      error instanceof Error && /^[a-z][a-z0-9]{0,63}$/i.test(error.name) ? error.name : 'Error';
    const diagnostic: {
      code?: string;
      errorName: string;
      operation: 'profile';
      retryable?: boolean;
    } = { errorName, operation: 'profile' };
    if (
      error instanceof ConnectorDataError &&
      error.provider === 'github' &&
      error.code === 'github_request_failed'
    ) {
      diagnostic.code = error.code;
      diagnostic.retryable = error.retryable;
    }
    log('Required collection failed: %O', diagnostic);
  };
  const supplementalOperations: SupplementalGitHubOperation[] = [
    {
      diagnostic: {
        code: 'GITHUB_PINNED_REPOSITORIES_FAILED',
        message: 'GitHub pinned repository enrichment failed',
        operation: 'pinnedRepositories',
      },
      run: async () => ({ pinnedRepositories: await pinnedRepositoriesPromise }),
    },
    {
      diagnostic: {
        code: 'GITHUB_RECENT_CONTRIBUTIONS_FAILED',
        message: 'GitHub recent contribution enrichment failed',
        operation: 'recentContributions',
      },
      run: async () => ({ recentContributions: await client.listRecentContributions() }),
    },
    {
      diagnostic: {
        code: 'GITHUB_RECENT_PULL_REQUESTS_FAILED',
        message: 'GitHub recent pull request enrichment failed',
        operation: 'recentPullRequests',
      },
      run: async () => ({ recentPullRequests: await client.listRecentPullRequests() }),
    },
    {
      diagnostic: {
        code: 'GITHUB_RECENT_REPOSITORIES_FAILED',
        message: 'GitHub recent repository enrichment failed',
        operation: 'recentRepositories',
      },
      run: async () => ({ recentRepositories: await client.listRecentRepositories() }),
    },
    {
      diagnostic: {
        code: 'GITHUB_ORGANIZATIONS_FAILED',
        message: 'GitHub organization enrichment failed',
        operation: 'organizations',
      },
      run: async () => ({ organizations: await client.listUserOrganizations() }),
    },
    {
      diagnostic: {
        code: 'GITHUB_PROFILE_README_FAILED',
        message: 'GitHub profile README enrichment failed',
        operation: 'profileReadme',
      },
      run: async () => ({ profileReadme: await client.getUserProfileReadme() }),
    },
  ];
  const supplementalResultsPromise = Promise.allSettled(
    supplementalOperations.map(({ run }) => run()),
  );
  const contributorBatchPromise = collectContributorOperations(client, pinnedRepositoriesPromise);
  let profile;
  try {
    profile = await profilePromise;
  } catch (error) {
    handleProfileError(error);
    throw new Error('GitHub profile collection failed', { cause: error });
  }

  const [supplementalResults, contributorBatch] = await Promise.all([
    supplementalResultsPromise,
    contributorBatchPromise,
  ]);
  const operations = [...supplementalOperations, ...contributorBatch.operations];
  const results = [...supplementalResults, ...contributorBatch.results];
  const context: GitHubUserContext = { profile };
  const errors: Array<SupplementalGitHubDiagnostic & { provider: 'github'; retryable: boolean }> =
    [];

  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected') {
      errors.push({
        ...operations[index].diagnostic,
        provider: 'github',
        retryable: result.reason instanceof ConnectorDataError ? result.reason.retryable : true,
      });
    } else {
      const { repositoryContributors, ...supplementalContext } = result.value;
      Object.assign(context, supplementalContext);
      if (repositoryContributors) {
        context.repositoryContributors = {
          ...context.repositoryContributors,
          ...repositoryContributors,
        };
      }
    }
  }

  return {
    context,
    errors,
    failedCount: errors.length,
    succeededCount: 1 + results.filter(({ status }) => status === 'fulfilled').length,
  };
};

const materializeGitHubProvider = ({
  db,
  ensureFreshConnector = ensureFreshConnectorToken,
  gateKeeper,
  userId,
  workspaceId,
}: GitHubProviderContextOptions): UnderstandingProvider<'github', GitHubCredential> => {
  const connectorModel = new ConnectorModel(db, userId, workspaceId, gateKeeper);
  const loadCredential = async (candidate: SourceCandidate<'github'>) => {
    switch (candidate.credentialOrigin) {
      case 'auth_account': {
        const id = parseCredentialReferenceId(candidate.credentialReference, 'auth_account');
        const [row] = await db
          .select({
            accessToken: account.accessToken,
            accessTokenExpiresAt: account.accessTokenExpiresAt,
            scope: account.scope,
          })
          .from(account)
          .where(
            and(eq(account.id, id), eq(account.userId, userId), eq(account.providerId, 'github')),
          )
          .limit(1);
        return row
          ? {
              accessToken: row.accessToken,
              expiresAt: row.accessTokenExpiresAt ?? undefined,
              scope: row.scope ?? undefined,
            }
          : undefined;
      }
      case 'connector': {
        const id = parseCredentialReferenceId(candidate.credentialReference, 'connector');
        const connector = await connectorModel.findById(id);
        if (
          !connector ||
          connector.identifier !== 'github' ||
          !connector.isEnabled ||
          connector.status !== 'connected'
        ) {
          return undefined;
        }
        const fresh = await ensureFreshConnector(connector, connectorModel);
        if (!fresh.credentials || fresh.credentials.type !== 'oauth2') return undefined;
        return {
          accessToken: fresh.credentials.accessToken,
          expiresAt: fresh.credentials.expiresAt ?? fresh.tokenExpiresAt ?? undefined,
          scope: fresh.credentials.scope,
        };
      }
      default: {
        return undefined;
      }
    }
  };

  return createGitHubUnderstandingProvider({
    loadCredential,
    queryAuthAccounts: () =>
      db
        .select({ id: account.id, providerId: account.providerId })
        .from(account)
        .where(and(eq(account.userId, userId), eq(account.providerId, 'github'))),
    queryConnectors: () => connectorModel.queryReferencesByIdentifiers(['github']),
  });
};

export const createGitHubUnderstandingProvider = ({
  loadCredential = async () => undefined,
  now = Date.now,
  queryAuthAccounts = async () => [],
  queryConnectors = async () => [],
}: GitHubProviderDependencies = {}): UnderstandingProvider<'github', GitHubCredential> => ({
  collect: async (source) => {
    const client = createGitHubConnectorClient({ accessToken: source.credential.accessToken });
    const { context, errors, failedCount, succeededCount } = await collectGitHubContext(client);
    const {
      organizations = [],
      pinnedRepositories = [],
      profileReadme,
      recentContributions = [],
      recentPullRequests = [],
      recentRepositories = [],
    } = context;
    const hasPrimaryProfileEvidence = Boolean(
      profileReadme || pinnedRepositories.length > 0 || recentContributions.length > 0,
    );
    const sourceCount =
      1 +
      organizations.length +
      (profileReadme ? 1 : 0) +
      pinnedRepositories.length +
      recentContributions.length +
      (hasPrimaryProfileEvidence ? 0 : recentRepositories.length + recentPullRequests.length);
    return {
      diagnostics: {
        errors,
        evidenceCount: sourceCount,
        failedCount,
        succeededCount,
      },
      sourceBrief: [
        'Provider: github',
        '# Source Brief',
        toGitHubUserContextMarkdown(context),
      ].join('\n\n'),
      sourceCount,
    };
  },
  discoverSources: async () => {
    const [accounts, connectors] = await Promise.all([queryAuthAccounts(), queryConnectors()]);
    return [
      ...accounts
        .filter(({ providerId }) => providerId === 'github')
        .map(({ id }) => ({
          candidateId: `auth_account:${id}`,
          credentialOrigin: 'auth_account' as const,
          credentialReference: `auth_account:${id}`,
          provider: 'github' as const,
        })),
      ...connectors
        .filter(({ isEnabled, status }) => isEnabled && status === 'connected')
        .map(({ id }) => ({
          candidateId: `connector:${id}`,
          credentialOrigin: 'connector' as const,
          credentialReference: `connector:${id}`,
          provider: 'github' as const,
        })),
    ].sort((left, right) => left.candidateId.localeCompare(right.candidateId));
  },
  id: 'github',
  identifySource: async (candidate) => {
    try {
      const loaded = LoadedGitHubCredentialSchema.safeParse(await loadCredential(candidate));
      if (!loaded.success || isExpired(loaded.data.expiresAt, now())) {
        throw new Error('Invalid GitHub credential');
      }
      const profile = await createGitHubConnectorClient({
        accessToken: loaded.data.accessToken,
      }).getUserProfile();
      return {
        credential: { accessToken: loaded.data.accessToken },
        displayName:
          profile.name && profile.login
            ? `${profile.name} (@${profile.login})`
            : (profile.name ?? profile.login),
        externalAccountId: profile.externalAccountId,
        grantedScopes: parseScopes(loaded.data.scope, loaded.data.scopes),
      };
    } catch (error) {
      throw new UnderstandingSourceIdentificationError({
        retryable: error instanceof ConnectorDataError ? error.retryable : false,
      });
    }
  },
  originPriority: ['connector', 'auth_account', 'integration'],
  requiredScopes: [],
  usefulOptionalScopes: ['read:user', 'user:email', 'read:org', 'repo'],
});

export const githubUnderstandingProvider = createGitHubUnderstandingProvider();

export const githubUnderstandingRegistration = {
  id: 'github',
  materialize: (scope) => ({
    provider: materializeGitHubProvider(scope),
  }),
} satisfies UnderstandingProviderRegistration;
