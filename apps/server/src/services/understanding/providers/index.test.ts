import { ConnectorDataError } from '@lobechat/connector-data';
import { describe, expect, it, vi } from 'vitest';

import type { UnderstandingProviderDefinition } from '../types';
import { createUnderstandingProviderRegistry } from '.';

vi.mock('./github', () => ({
  createGitHubUnderstandingProvider: vi.fn(),
  githubUnderstandingRegistration: { id: 'github' },
}));
vi.mock('./gmail', () => ({
  createGmailUnderstandingProvider: vi.fn(),
  gmailUnderstandingRegistration: { id: 'gmail' },
}));

const context = { userId: 'user-1' };
const diagnostics = { errors: [], evidenceCount: 1, failedCount: 0, succeededCount: 1 };

const definition = (
  overrides: Partial<UnderstandingProviderDefinition<'example', { token: string }>> = {},
): UnderstandingProviderDefinition<'example', { token: string }> => ({
  collect: vi.fn(async () => ({ context: '# collected', diagnostics, sourceCount: 1 })),
  discoverCandidates: vi.fn(async () => [
    {
      candidateId: 'connector:b',
      credentialOrigin: 'connector',
      credentialReference: 'connector:b',
      provider: 'example',
    },
  ]),
  id: 'example',
  identifyCandidate: vi.fn(async () => ({
    credential: { token: 'private-token' },
    externalAccountId: 'account-1',
    grantedScopes: ['read'],
  })),
  originPriority: ['connector', 'auth_account', 'integration'],
  requiredScopes: ['read'],
  usefulOptionalScopes: ['extra'],
  ...overrides,
});

describe('createUnderstandingProviderRegistry', () => {
  it('exposes only provider id and a single collection operation', () => {
    const [provider] = createUnderstandingProviderRegistry([definition()]).list();

    expect(Object.keys(provider).sort()).toEqual(['collect', 'id']);
  });

  it('selects by required scopes, optional scopes, origin, then stable candidate id', async () => {
    const collect = vi.fn(async () => ({ context: '# chosen', diagnostics, sourceCount: 1 }));
    const provider = definition({
      collect,
      discoverCandidates: vi.fn(async () => [
        {
          candidateId: 'connector:z',
          credentialOrigin: 'connector',
          credentialReference: 'z',
          provider: 'example',
        },
        {
          candidateId: 'integration:a',
          credentialOrigin: 'integration',
          credentialReference: 'a',
          provider: 'example',
        },
        {
          candidateId: 'auth_account:c',
          credentialOrigin: 'auth_account',
          credentialReference: 'c',
          provider: 'example',
        },
        {
          candidateId: 'connector:a',
          credentialOrigin: 'connector',
          credentialReference: 'a',
          provider: 'example',
        },
      ]),
      identifyCandidate: vi.fn(async (candidate) => ({
        credential: { token: `private-${candidate.candidateId}` },
        externalAccountId: candidate.candidateId,
        grantedScopes:
          candidate.candidateId === 'integration:a'
            ? ['read']
            : candidate.candidateId === 'auth_account:c'
              ? ['read', 'extra']
              : candidate.candidateId === 'connector:a'
                ? ['read', 'extra']
                : [],
      })),
    });
    const registered = createUnderstandingProviderRegistry([provider]).get('example')!;

    await registered.collect(context);

    expect(collect).toHaveBeenCalledOnce();
    expect(collect.mock.calls[0][0]).toMatchObject({ candidateId: 'connector:a' });
  });

  it('keeps credentials non-enumerable throughout collection', async () => {
    const collect = vi.fn(async (source) => {
      expect(source.credential).toEqual({ token: 'private-token' });
      expect(JSON.stringify(source)).not.toContain('private-token');
      return { context: '# collected', diagnostics, sourceCount: 1 };
    });
    const registered = createUnderstandingProviderRegistry([definition({ collect })]).get(
      'example',
    )!;

    await expect(registered.collect(context)).resolves.toMatchObject({ context: '# collected' });
  });

  it('rejects candidates missing a required scope without collecting', async () => {
    const collect = vi.fn(async () => ({
      context: '# should not run',
      diagnostics,
      sourceCount: 1,
    }));
    const registered = createUnderstandingProviderRegistry([
      definition({
        collect,
        identifyCandidate: vi.fn(async () => ({
          credential: { token: 'private-token' },
          externalAccountId: 'account-1',
          grantedScopes: ['extra'],
        })),
      }),
    ]).get('example')!;

    await expect(registered.collect(context)).resolves.toMatchObject({
      context: '',
      diagnostics: {
        errors: [expect.objectContaining({ code: 'UNDERSTANDING_PROVIDER_AUTHORIZATION_FAILED' })],
      },
      sourceCount: 0,
    });
    expect(collect).not.toHaveBeenCalled();
  });

  it('returns bounded diagnostics for permanent absence and authorization failure', async () => {
    const absent = createUnderstandingProviderRegistry([
      definition({ discoverCandidates: vi.fn(async () => []) }),
    ]).get('example')!;
    await expect(absent.collect(context)).resolves.toMatchObject({
      context: '',
      diagnostics: { failedCount: 1, succeededCount: 0 },
      sourceCount: 0,
    });

    const unauthorized = createUnderstandingProviderRegistry([
      definition({
        identifyCandidate: vi.fn(async () => {
          throw new Error('private token');
        }),
      }),
    ]).get('example')!;
    const result = await unauthorized.collect(context);
    expect(result.diagnostics.errors[0]).toMatchObject({
      code: 'UNDERSTANDING_PROVIDER_AUTHORIZATION_FAILED',
      provider: 'example',
      retryable: false,
    });
    expect(JSON.stringify(result)).not.toContain('private token');
  });

  it('rethrows sanitized transient connector failures for workflow retry', async () => {
    const upstream = new ConnectorDataError({
      code: 'private_code',
      operation: 'private_operation',
      provider: 'example',
      retryable: true,
    });
    upstream.message = 'private token';
    const registered = createUnderstandingProviderRegistry([
      definition({
        identifyCandidate: vi.fn(async () => {
          throw upstream;
        }),
      }),
    ]).get('example')!;

    const error = await registered.collect(context).catch((caught) => caught);
    expect(error).toMatchObject({ name: 'UnderstandingProviderRetryableError', retryable: true });
    expect(String(error)).not.toContain('private');
  });

  it('retries when one identification is transient even if a fallback succeeds', async () => {
    const upstream = new ConnectorDataError({
      code: 'private_code',
      operation: 'private_operation',
      provider: 'example',
      retryable: true,
    });
    const collect = vi.fn();
    const registered = createUnderstandingProviderRegistry([
      definition({
        collect,
        discoverCandidates: vi.fn(async () => [
          {
            candidateId: 'connector:available',
            credentialOrigin: 'connector',
            credentialReference: 'connector:available',
            provider: 'example',
          },
          {
            candidateId: 'auth_account:transient',
            credentialOrigin: 'auth_account',
            credentialReference: 'auth_account:transient',
            provider: 'example',
          },
        ]),
        identifyCandidate: vi.fn(async (candidate) => {
          if (candidate.candidateId === 'auth_account:transient') throw upstream;
          return {
            credential: { token: 'fallback-token' },
            externalAccountId: 'fallback',
            grantedScopes: ['read'],
          };
        }),
      }),
    ]).get('example')!;

    await expect(registered.collect(context)).rejects.toMatchObject({
      name: 'UnderstandingProviderRetryableError',
      retryable: true,
    });
    expect(collect).not.toHaveBeenCalled();
  });
});
