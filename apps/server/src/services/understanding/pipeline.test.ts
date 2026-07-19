import { describe, expect, it, vi } from 'vitest';

import { discoverUnderstandingSources } from './pipeline';
import {
  createUnderstandingProviderRegistry,
  materializeUnderstandingProviders,
  toPublicUnderstandingSourceRef,
} from './providers';
import type {
  CredentialOrigin,
  IdentifiedUnderstandingSource,
  SourceCandidate,
  UnderstandingProvider,
  UnderstandingProviderContext,
} from './types';
import { UnderstandingSourceIdentificationError } from './types';

interface FakeCredential {
  token: string;
}

interface CandidateFixture<Provider extends string = string> {
  account: string;
  candidateId: string;
  credentialOrigin: CredentialOrigin;
  credentialReference: string;
  provider: Provider;
  scopes?: string[];
}

const context: UnderstandingProviderContext = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
};

const candidate = <Provider extends string>({
  candidateId,
  credentialOrigin,
  credentialReference,
  provider,
}: CandidateFixture<Provider>): SourceCandidate<Provider> => ({
  candidateId,
  credentialOrigin,
  credentialReference,
  provider,
});

const fakeProvider = <Provider extends string>(
  provider: Provider,
  fixtures: CandidateFixture<Provider>[],
  overrides: Partial<UnderstandingProvider<Provider, FakeCredential>> = {},
): UnderstandingProvider<Provider, FakeCredential> => {
  const byId = new Map(fixtures.map((fixture) => [fixture.candidateId, fixture]));

  return {
    collect: vi.fn(),
    discoverSources: vi.fn().mockResolvedValue(fixtures.map(candidate)),
    identifySource: vi.fn(async (sourceCandidate) => {
      const fixture = byId.get(sourceCandidate.candidateId);
      if (!fixture) throw new Error('unknown candidate');
      return {
        credential: { token: `secret-${fixture.candidateId}` },
        displayName: fixture.account,
        externalAccountId: fixture.account,
        grantedScopes: fixture.scopes ?? [],
      } satisfies IdentifiedUnderstandingSource<FakeCredential>;
    }),
    originPriority: ['auth_account', 'connector', 'integration'],
    id: provider,
    requiredScopes: ['read'],
    usefulOptionalScopes: ['email', 'profile'],
    ...overrides,
  };
};

describe('discoverUnderstandingSources', () => {
  it('materializes a third provider generically', () => {
    const notion = fakeProvider('notion', []);
    const registration = {
      id: 'notion',
      materialize: () => ({ provider: notion }),
    };
    const materialized = materializeUnderstandingProviders([registration], {
      db: {} as any,
      userId: 'user-1',
    });

    expect(materialized.registry.get('notion')?.id).toBe('notion');
    expect(materialized.context).toEqual({ userId: 'user-1', workspaceId: undefined });
  });

  it('discovers every registered provider and deduplicates accounts without collecting', async () => {
    const github = fakeProvider('github', [
      {
        account: 'A',
        candidateId: 'github-connector',
        credentialOrigin: 'connector',
        credentialReference: 'connector-1',
        provider: 'github',
        scopes: ['read'],
      },
      {
        account: 'A',
        candidateId: 'github-login',
        credentialOrigin: 'auth_account',
        credentialReference: 'account-1',
        provider: 'github',
        scopes: ['read', 'email'],
      },
    ]);
    const gmail = fakeProvider('gmail', [
      {
        account: 'B',
        candidateId: 'gmail-connector',
        credentialOrigin: 'connector',
        credentialReference: 'connector-2',
        provider: 'gmail',
        scopes: ['read'],
      },
    ]);
    const notion = fakeProvider('notion-test', [
      {
        account: 'C',
        candidateId: 'notion-integration',
        credentialOrigin: 'integration',
        credentialReference: 'integration-1',
        provider: 'notion-test',
        scopes: ['read'],
      },
    ]);

    const result = await discoverUnderstandingSources(
      createUnderstandingProviderRegistry([github, gmail, notion]),
      context,
    );

    expect(github.discoverSources).toHaveBeenCalledWith(context);
    expect(gmail.discoverSources).toHaveBeenCalledWith(context);
    expect(notion.discoverSources).toHaveBeenCalledWith(context);
    expect(
      result.sources.map(({ candidateId, externalAccountId, provider }) => ({
        candidateId,
        externalAccountId,
        provider,
      })),
    ).toEqual([
      { candidateId: 'github-login', externalAccountId: 'A', provider: 'github' },
      { candidateId: 'gmail-connector', externalAccountId: 'B', provider: 'gmail' },
      { candidateId: 'notion-integration', externalAccountId: 'C', provider: 'notion-test' },
    ]);
    expect(github.collect).not.toHaveBeenCalled();
    expect(gmail.collect).not.toHaveBeenCalled();
    expect(notion.collect).not.toHaveBeenCalled();
  });

  it('ranks candidates by required scopes, optional scopes, origin, then candidate id', async () => {
    const fixtures: CandidateFixture[] = [
      {
        account: 'required',
        candidateId: 'missing-required',
        credentialOrigin: 'auth_account',
        credentialReference: 'one',
        provider: 'github',
        scopes: ['email', 'profile'],
      },
      {
        account: 'required',
        candidateId: 'has-required',
        credentialOrigin: 'integration',
        credentialReference: 'two',
        provider: 'github',
        scopes: ['read'],
      },
      {
        account: 'optional',
        candidateId: 'fewer-optional',
        credentialOrigin: 'auth_account',
        credentialReference: 'three',
        provider: 'github',
        scopes: ['read', 'email'],
      },
      {
        account: 'optional',
        candidateId: 'more-optional',
        credentialOrigin: 'integration',
        credentialReference: 'four',
        provider: 'github',
        scopes: ['read', 'email', 'profile'],
      },
      {
        account: 'origin',
        candidateId: 'connector-origin',
        credentialOrigin: 'connector',
        credentialReference: 'five',
        provider: 'github',
        scopes: ['read'],
      },
      {
        account: 'origin',
        candidateId: 'auth-origin',
        credentialOrigin: 'auth_account',
        credentialReference: 'six',
        provider: 'github',
        scopes: ['read'],
      },
      {
        account: 'lexical',
        candidateId: 'z-candidate',
        credentialOrigin: 'connector',
        credentialReference: 'seven',
        provider: 'github',
        scopes: ['read'],
      },
      {
        account: 'lexical',
        candidateId: 'a-candidate',
        credentialOrigin: 'connector',
        credentialReference: 'eight',
        provider: 'github',
        scopes: ['read'],
      },
    ];

    const result = await discoverUnderstandingSources(
      createUnderstandingProviderRegistry([fakeProvider('github', fixtures)]),
      context,
    );

    expect(
      Object.fromEntries(
        result.sources.map((source) => [source.externalAccountId, source.candidateId]),
      ),
    ).toEqual({
      lexical: 'a-candidate',
      optional: 'more-optional',
      origin: 'auth-origin',
      required: 'has-required',
    });
  });

  it('isolates invalid candidates and provider discovery rejections with sanitized errors', async () => {
    const invalidToken = 'do-not-leak-invalid-token';
    const discoveryToken = 'do-not-leak-discovery-token';
    const github = fakeProvider(
      'github',
      [
        {
          account: 'invalid',
          candidateId: 'invalid-candidate',
          credentialOrigin: 'connector',
          credentialReference: invalidToken,
          provider: 'github',
        },
        {
          account: 'valid',
          candidateId: 'valid-candidate',
          credentialOrigin: 'connector',
          credentialReference: 'connector-valid',
          provider: 'github',
          scopes: ['read'],
        },
      ],
      {
        identifySource: vi.fn(async (sourceCandidate) => {
          if (sourceCandidate.candidateId === 'invalid-candidate') {
            throw new Error(`expired ${invalidToken}`);
          }
          return {
            credential: { token: 'valid-secret' },
            externalAccountId: 'valid',
            grantedScopes: ['read'],
          };
        }),
      },
    );
    const gmail = fakeProvider('gmail', [], {
      discoverSources: vi.fn().mockRejectedValue(new Error(`unavailable ${discoveryToken}`)),
    });
    const notion = fakeProvider('notion-test', [
      {
        account: 'notion',
        candidateId: 'notion-valid',
        credentialOrigin: 'integration',
        credentialReference: 'notion-ref',
        provider: 'notion-test',
        scopes: ['read'],
      },
    ]);

    const result = await discoverUnderstandingSources(
      createUnderstandingProviderRegistry([github, gmail, notion]),
      context,
    );

    expect(result.sources.map((source) => source.externalAccountId)).toEqual(['valid', 'notion']);
    expect(result.errors).toEqual([
      {
        code: 'UNDERSTANDING_SOURCE_IDENTIFICATION_FAILED',
        message: 'A github source candidate could not be identified',
        operation: 'identifySource',
        provider: 'github',
        retryable: false,
      },
      {
        code: 'UNDERSTANDING_SOURCE_DISCOVERY_FAILED',
        message: 'gmail source discovery failed',
        operation: 'discoverSources',
        provider: 'gmail',
        retryable: true,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain(invalidToken);
    expect(JSON.stringify(result)).not.toContain(discoveryToken);
  });

  it('publishes transient identification retryability without leaking the rejection', async () => {
    const failure = new UnderstandingSourceIdentificationError({ retryable: true });
    failure.message = '503 upstream secret-token response';
    const github = fakeProvider(
      'github',
      [
        {
          account: 'retryable',
          candidateId: 'retryable-candidate',
          credentialOrigin: 'connector',
          credentialReference: 'secret-reference',
          provider: 'github',
        },
      ],
      { identifySource: vi.fn().mockRejectedValue(failure) },
    );

    const result = await discoverUnderstandingSources(
      createUnderstandingProviderRegistry([github]),
      context,
    );

    expect(result.errors).toEqual([
      {
        code: 'UNDERSTANDING_SOURCE_IDENTIFICATION_FAILED',
        message: 'A github source candidate could not be identified',
        operation: 'identifySource',
        provider: 'github',
        retryable: true,
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/503|secret-token|secret-reference|upstream/);
  });

  it('isolates a synchronous discovery throw and continues other providers', async () => {
    const github = fakeProvider('github', [], {
      discoverSources: vi.fn(() => {
        throw new Error('synchronous secret failure');
      }),
    });
    const gmail = fakeProvider('gmail', [
      {
        account: 'mail-account',
        candidateId: 'gmail-valid',
        credentialOrigin: 'connector',
        credentialReference: 'gmail-ref',
        provider: 'gmail',
        scopes: ['read'],
      },
    ]);

    const result = await discoverUnderstandingSources(
      createUnderstandingProviderRegistry([github, gmail]),
      context,
    );

    expect(result.sources.map((source) => source.externalAccountId)).toEqual(['mail-account']);
    expect(result.errors).toEqual([
      {
        code: 'UNDERSTANDING_SOURCE_DISCOVERY_FAILED',
        message: 'github source discovery failed',
        operation: 'discoverSources',
        provider: 'github',
        retryable: true,
      },
    ]);
  });

  it('returns sources in deterministic provider and account order', async () => {
    const provider = fakeProvider('github', [
      {
        account: 'z-account',
        candidateId: 'candidate-z',
        credentialOrigin: 'connector',
        credentialReference: 'z',
        provider: 'github',
        scopes: ['read'],
      },
      {
        account: 'a-account',
        candidateId: 'candidate-a',
        credentialOrigin: 'connector',
        credentialReference: 'a',
        provider: 'github',
        scopes: ['read'],
      },
    ]);

    const first = await discoverUnderstandingSources(
      createUnderstandingProviderRegistry([provider]),
      context,
    );
    const second = await discoverUnderstandingSources(
      createUnderstandingProviderRegistry([provider]),
      context,
    );

    expect(first.sources.map((source) => source.externalAccountId)).toEqual([
      'a-account',
      'z-account',
    ]);
    expect(second.sources.map((source) => source.id)).toEqual(
      first.sources.map((source) => source.id),
    );
  });

  it('keeps credentials request-scoped and absent from public references', async () => {
    const provider = fakeProvider('github', [
      {
        account: 'A',
        candidateId: 'candidate-a',
        credentialOrigin: 'connector',
        credentialReference: 'connector-a',
        provider: 'github',
        scopes: ['read'],
      },
    ]);

    const result = await discoverUnderstandingSources(
      createUnderstandingProviderRegistry([provider]),
      context,
    );
    const [source] = result.sources;

    expect(source.credential).toEqual({ token: 'secret-candidate-a' });
    expect(Object.keys(source)).not.toContain('credential');
    expect(JSON.stringify(source)).not.toContain('secret-candidate-a');
    expect(toPublicUnderstandingSourceRef(source)).toEqual({
      displayName: 'A',
      externalAccountId: 'A',
      id: 'github:A',
      provider: 'github',
    });
    expect(JSON.stringify(toPublicUnderstandingSourceRef(source))).not.toContain('credential');
  });

  it('re-resolves only the referenced provider account without rediscovery', async () => {
    const provider = fakeProvider('github', [
      {
        account: 'A',
        candidateId: 'connector:a',
        credentialOrigin: 'connector',
        credentialReference: 'connector:a',
        provider: 'github',
        scopes: ['read'],
      },
      {
        account: 'B',
        candidateId: 'connector:b',
        credentialOrigin: 'connector',
        credentialReference: 'connector:b',
        provider: 'github',
        scopes: ['read'],
      },
    ]);
    const registered = createUnderstandingProviderRegistry([provider]).get('github')!;

    const resolved = await registered.resolveSource(
      {
        externalAccountId: 'A',
        id: 'github:A',
        provider: 'github',
      },
      {
        candidateId: 'connector:a',
        credentialOrigin: 'connector',
        credentialReference: 'connector:a',
        provider: 'github',
      },
      context,
    );

    expect(resolved?.externalAccountId).toBe('A');
    expect(provider.discoverSources).not.toHaveBeenCalled();
    expect(provider.identifySource).toHaveBeenCalledOnce();
    expect(provider.identifySource).toHaveBeenCalledWith(
      expect.objectContaining({ candidateId: 'connector:a' }),
      context,
    );
  });
});

describe('createUnderstandingProviderRegistry', () => {
  it('preserves provider method this semantics', async () => {
    interface StatefulProvider extends UnderstandingProvider<'stateful', FakeCredential> {
      account: string;
    }

    const provider: StatefulProvider = {
      account: 'state-backed-account',
      collect: vi.fn(),
      async discoverSources() {
        return [
          {
            candidateId: 'stateful-candidate',
            credentialOrigin: 'connector',
            credentialReference: this.account,
            provider: 'stateful',
          },
        ];
      },
      id: 'stateful',
      async identifySource() {
        return {
          credential: { token: this.account },
          externalAccountId: this.account,
          grantedScopes: [],
        };
      },
      originPriority: ['connector'],
      requiredScopes: [],
      usefulOptionalScopes: [],
    };
    const registered = createUnderstandingProviderRegistry([provider]).get('stateful')!;

    const [source] = await registered.discoverSources(context);
    const identified = await registered.identifySource(source, context);

    expect(source.credentialReference).toBe(provider.account);
    expect(identified).toEqual({
      credential: { token: provider.account },
      externalAccountId: provider.account,
      grantedScopes: [],
    });
  });

  it('rejects duplicate providers', () => {
    const provider = fakeProvider('github', []);

    expect(() => createUnderstandingProviderRegistry([provider, provider])).toThrow(
      'Understanding provider "github" is already registered',
    );
  });
});
