import {
  ConnectorDataError,
  getConnectorErrorMessage,
  isConnectorErrorRetryable,
} from '@lobechat/connector-data';
import {
  getUnderstandingSourceFingerprint,
  StaleUnderstandingRevisionError,
  StaleUnderstandingSessionError,
  UnderstandingResourceNotFoundError,
} from '@lobechat/database';
import {
  observeOnboardingUnderstandingOperation,
  observeOnboardingUnderstandingProviderCollection,
} from '@lobechat/observability-otel/modules/onboarding-understanding';
import type { CollectionDiagnostics } from '@lobechat/types';

import { MAX_SOURCE_BRIEF_LENGTH } from '../sourceStore';
import { UnderstandingProviderContextUnavailableError } from './errors';
import { readActiveSession } from './session';
import type { ProviderOperationInput, UnderstandingServiceDependencies } from './types';
import { boundProviderDiagnostics, createCollectionError } from './utils';

/**
 * Normalizes a thrown provider value into the persisted diagnostic shape without replacing its
 * original message.
 *
 * Before:
 * - `Error("GraphQL FORBIDDEN at viewer.repository")`
 *
 * After:
 * - `{ provider: "github", operation: "collection", message: "GraphQL FORBIDDEN at viewer.repository" }`
 */
const createProviderCollectionError = (providerId: string, error: unknown) => {
  const connectorError = error instanceof ConnectorDataError ? error : undefined;
  return createCollectionError(
    providerId,
    connectorError?.operation ?? 'collection',
    connectorError?.code ?? 'UNDERSTANDING_PROVIDER_COLLECTION_FAILED',
    isConnectorErrorRetryable(error),
    getConnectorErrorMessage(error) ?? String(error),
  );
};

export const processProvider = async (
  dependencies: UnderstandingServiceDependencies,
  input: ProviderOperationInput,
) =>
  observeOnboardingUnderstandingOperation(
    {
      operation: 'provider.process',
      providerId: input.providerId,
      sessionId: input.sessionId,
      topicId: input.topicId,
    },
    async () => {
      const operationAttributes = {
        providerId: input.providerId,
        sessionId: input.sessionId,
        topicId: input.topicId,
      };
      const session = await observeOnboardingUnderstandingOperation(
        { ...operationAttributes, operation: 'session.read' },
        () => readActiveSession(dependencies, input.topicId, input.sessionId),
      );
      const provider = dependencies.providers.get(input.providerId);
      const state = session.sources[input.providerId];
      if (!provider || !state) throw new UnderstandingResourceNotFoundError('session');
      const stale = () => ({
        failedCount: 0,
        providerId: input.providerId,
        revision: input.revision,
        sourceCount: 0,
        status: 'stale' as const,
        succeededCount: 0,
      });

      if (state.status === 'completed') {
        if (state.revision !== input.revision) return stale();
        const sourceFingerprint = getUnderstandingSourceFingerprint(session);
        if (!sourceFingerprint) throw new UnderstandingProviderContextUnavailableError();
        const stored = await dependencies.sourceStore().get({
          providerId: input.providerId,
          revision: input.revision,
          sessionId: input.sessionId,
          userId: dependencies.userId,
        });
        if (stored) {
          return {
            failedCount: stored.diagnostics.failedCount,
            providerId: input.providerId,
            revision: input.revision,
            sourceCount: stored.sourceCount,
            sourceFingerprint,
            status: 'completed' as const,
            succeededCount: stored.diagnostics.succeededCount,
          };
        }
        const expired = await dependencies.repository.expireProviderContexts({
          providers: [{ providerId: input.providerId, revision: input.revision }],
          sessionId: input.sessionId,
          sourceFingerprint,
          topicId: input.topicId,
        });
        const expiredState = expired.sources[input.providerId];
        return expiredState?.revision === input.revision && expiredState.status === 'failed'
          ? {
              failedCount: expiredState.failedCount,
              providerId: input.providerId,
              revision: input.revision,
              sourceCount: 0,
              status: 'failed' as const,
              succeededCount: expiredState.succeededCount,
            }
          : stale();
      }

      if (state.status === 'pending') {
        if (state.revision + 1 !== input.revision) return stale();
        const running = await observeOnboardingUnderstandingOperation(
          { ...operationAttributes, operation: 'provider.mark-running' },
          () =>
            dependencies.repository.markProviderRunning(
              input.topicId,
              input.sessionId,
              input.providerId,
            ),
        );
        if (running.revision !== input.revision) return stale();
      } else if (state.status !== 'running' || state.revision !== input.revision) {
        return stale();
      }

      let collection;
      try {
        collection = await observeOnboardingUnderstandingProviderCollection(
          operationAttributes,
          async () => {
            const collected = await provider.collect({
              connectorData: dependencies.connectorData,
              userId: dependencies.userId,
            });
            const context = collected.context.trim().slice(0, MAX_SOURCE_BRIEF_LENGTH);
            const diagnostics = boundProviderDiagnostics(collected.diagnostics);
            const usable =
              Boolean(context) &&
              collected.sourceCount > 0 &&
              diagnostics.evidenceCount > 0 &&
              diagnostics.succeededCount > 0;
            const outcome = !usable
              ? ('failed' as const)
              : diagnostics.failedCount > 0 || diagnostics.errors.length > 0
                ? ('partial' as const)
                : ('completed' as const);

            return {
              diagnostics: diagnostics.errors,
              evidenceCount: diagnostics.evidenceCount,
              failedCount: diagnostics.failedCount,
              outcome,
              result: { context, diagnostics, sourceCount: collected.sourceCount, usable },
              sourceCount: collected.sourceCount,
              succeededCount: diagnostics.succeededCount,
            };
          },
          (error) => createProviderCollectionError(input.providerId, error),
        );
      } catch (error) {
        const diagnostic = createProviderCollectionError(input.providerId, error);
        if (diagnostic.retryable) throw error;
        return recordProviderFailure(dependencies, input, 0, {
          errors: [diagnostic],
          evidenceCount: 0,
          failedCount: 1,
          succeededCount: 0,
        });
      }

      const { context, diagnostics, sourceCount, usable } = collection;
      if (!usable)
        return recordProviderFailure(dependencies, input, diagnostics.succeededCount, diagnostics);

      const stored = {
        context,
        diagnostics,
        providerId: input.providerId,
        revision: input.revision,
        sessionId: input.sessionId,
        sourceCount,
        userId: dependencies.userId,
      };
      await observeOnboardingUnderstandingOperation(
        { ...operationAttributes, operation: 'provider.persist-context' },
        () => dependencies.sourceStore().put(stored),
      );
      const transition = await observeOnboardingUnderstandingOperation(
        { ...operationAttributes, operation: 'provider.complete' },
        () =>
          dependencies.repository.completeProvider({
            errors: diagnostics.errors,
            failedCount: diagnostics.failedCount,
            providerId: input.providerId,
            revision: input.revision,
            sessionId: input.sessionId,
            succeededCount: diagnostics.succeededCount,
            topicId: input.topicId,
          }),
      );
      const sourceFingerprint = getUnderstandingSourceFingerprint(transition);
      if (!sourceFingerprint) throw new UnderstandingProviderContextUnavailableError();
      return {
        failedCount: diagnostics.failedCount,
        providerId: input.providerId,
        revision: input.revision,
        sourceCount,
        sourceFingerprint,
        status: 'completed' as const,
        succeededCount: diagnostics.succeededCount,
      };
    },
  );

export const failProvider = async (
  dependencies: UnderstandingServiceDependencies,
  input: ProviderOperationInput,
) => {
  try {
    return await dependencies.repository.failProvider({
      errors: [
        createCollectionError(
          input.providerId,
          'collection',
          'UNDERSTANDING_PROVIDER_COLLECTION_FAILED',
          true,
        ),
      ],
      failedCount: 1,
      providerId: input.providerId,
      revision: input.revision,
      sessionId: input.sessionId,
      succeededCount: 0,
      topicId: input.topicId,
    });
  } catch (error) {
    if (
      error instanceof StaleUnderstandingRevisionError ||
      error instanceof StaleUnderstandingSessionError
    ) {
      return;
    }
    throw error;
  }
};

const recordProviderFailure = async (
  dependencies: UnderstandingServiceDependencies,
  input: ProviderOperationInput,
  succeededCount: number,
  diagnostics?: CollectionDiagnostics,
) => {
  const errors = diagnostics?.errors.length
    ? diagnostics.errors
    : [
        createCollectionError(
          input.providerId,
          'collection',
          'UNDERSTANDING_PROVIDER_COLLECTION_FAILED',
          false,
        ),
      ];
  await dependencies.repository.failProvider({
    errors,
    failedCount: Math.max(1, diagnostics?.failedCount ?? 1),
    providerId: input.providerId,
    revision: input.revision,
    sessionId: input.sessionId,
    succeededCount,
    topicId: input.topicId,
  });
  return {
    failedCount: Math.max(1, diagnostics?.failedCount ?? 1),
    providerId: input.providerId,
    revision: input.revision,
    sourceCount: 0,
    status: 'failed' as const,
    succeededCount,
  };
};
