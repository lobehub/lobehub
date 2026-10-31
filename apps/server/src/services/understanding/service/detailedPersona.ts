import { TRACING_SCENARIOS } from '@lobechat/const';
import {
  getUnderstandingSourceFingerprint,
  StaleUnderstandingRevisionError,
  StaleUnderstandingSessionError,
} from '@lobechat/database';
import { observeOnboardingUnderstandingOperation } from '@lobechat/observability-otel/modules/onboarding-understanding';
import {
  chainUnderstandingDetailedPersona,
  UNDERSTANDING_DETAILED_PERSONA_JSON_SCHEMA,
  UNDERSTANDING_DETAILED_PERSONA_PROMPT_VERSION,
} from '@lobechat/prompts';
import type { UnderstandingPersonaProposal } from '@lobechat/types';
import { RequestTrigger, UnderstandingPersonaProposalSchema } from '@lobechat/types';
import pMap from 'p-map';

import type { StoredUnderstandingProviderContext } from '../sourceStore';
import { UnderstandingProviderContextUnavailableError } from './errors';
import { readActiveSession } from './session';
import type { ProcessCollectedInput, UnderstandingServiceDependencies } from './types';
import {
  buildEphemeralDocument,
  createCollectionError,
  PROVIDER_IO_CONCURRENCY,
  storedProposal,
} from './utils';

export const processDetailedPersona = async (
  dependencies: UnderstandingServiceDependencies,
  { expectedSourceFingerprint, responseLanguage, sessionId, topicId }: ProcessCollectedInput,
) =>
  observeOnboardingUnderstandingOperation(
    { operation: 'detailed.process', sessionId, topicId },
    async () => {
      const operationAttributes = { sessionId, topicId };
      const session = await observeOnboardingUnderstandingOperation(
        { ...operationAttributes, operation: 'session.read' },
        () => readActiveSession(dependencies, topicId, sessionId),
      );
      const writing = session.writing;
      if (
        getUnderstandingSourceFingerprint(session) !== expectedSourceFingerprint ||
        writing?.status !== 'completed' ||
        writing.sourceFingerprint !== expectedSourceFingerprint
      ) {
        return { published: false as const, sourceFingerprint: expectedSourceFingerprint };
      }
      if (writing.detailed?.status === 'completed') {
        return { published: true as const, sourceFingerprint: expectedSourceFingerprint };
      }
      if (writing.detailed?.status !== 'running') {
        return { published: false as const, sourceFingerprint: expectedSourceFingerprint };
      }

      const resultMessage = await observeOnboardingUnderstandingOperation(
        { ...operationAttributes, operation: 'detailed.read-result' },
        () => dependencies.messages.findById(writing.resultMessageId),
      );
      const proposal = storedProposal(resultMessage?.metadata);
      if (!proposal) throw new UnderstandingProviderContextUnavailableError();
      if (
        proposal.sourceFingerprint !== expectedSourceFingerprint ||
        proposal.feedbackRevision !== writing.feedbackRevision ||
        proposal.generationRevision !== writing.generationRevision
      ) {
        return { published: false as const, sourceFingerprint: expectedSourceFingerprint };
      }

      const completed = Object.entries(session.sources)
        .filter(([, state]) => state.status === 'completed')
        .sort(([left], [right]) => left.localeCompare(right));
      const sourceStore = dependencies.sourceStore();
      const contexts = await observeOnboardingUnderstandingOperation(
        { ...operationAttributes, operation: 'writer.read-contexts' },
        () =>
          pMap(
            completed,
            ([providerId, state]) =>
              sourceStore.get({
                providerId,
                revision: state.revision,
                sessionId,
                userId: dependencies.userId,
              }),
            { concurrency: PROVIDER_IO_CONCURRENCY },
          ),
      );
      if (contexts.some((context) => !context)) {
        throw new UnderstandingProviderContextUnavailableError();
      }

      const baseline = await observeOnboardingUnderstandingOperation(
        { ...operationAttributes, operation: 'detailed.read-baseline' },
        () => dependencies.persona.getLatestPersonaDocument(),
      );
      const writerAgent = await observeOnboardingUnderstandingOperation(
        { ...operationAttributes, operation: 'writer.resolve-agent' },
        () => dependencies.writerAgent(),
      );
      const detailedPersona: UnderstandingPersonaProposal =
        UnderstandingPersonaProposalSchema.parse(
          await observeOnboardingUnderstandingOperation(
            { ...operationAttributes, operation: 'detailed.generate' },
            () =>
              dependencies.generator.generateObject(
                {
                  ...chainUnderstandingDetailedPersona({
                    analysis: proposal.analysis,
                    context: buildEphemeralDocument(
                      contexts as StoredUnderstandingProviderContext[],
                      baseline,
                    ),
                    responseLanguage,
                  }),
                  model: writerAgent.model,
                  provider: writerAgent.provider,
                  schema: UNDERSTANDING_DETAILED_PERSONA_JSON_SCHEMA,
                  thinking: { type: 'disabled' },
                },
                {
                  metadata: { trigger: RequestTrigger.Onboarding },
                  tracing: {
                    promptVersion: UNDERSTANDING_DETAILED_PERSONA_PROMPT_VERSION,
                    scenario: TRACING_SCENARIOS.UnderstandingDetailedPersona,
                    schemaName: UNDERSTANDING_DETAILED_PERSONA_JSON_SCHEMA.name,
                  },
                },
              ),
          ),
        );
      const committed = await observeOnboardingUnderstandingOperation(
        { ...operationAttributes, operation: 'detailed.commit' },
        () =>
          dependencies.repository.commitDetailedWriting({
            detailedPersona,
            feedbackRevision: writing.feedbackRevision ?? 0,
            generationRevision: writing.generationRevision ?? 0,
            sessionId,
            sourceFingerprint: expectedSourceFingerprint,
            topicId,
          }),
      );
      return { ...committed, sourceFingerprint: expectedSourceFingerprint };
    },
  );

export const failDetailedPersona = async (
  dependencies: UnderstandingServiceDependencies,
  {
    sessionId,
    sourceFingerprint,
    topicId,
  }: {
    sessionId: string;
    sourceFingerprint: string;
    topicId: string;
  },
) => {
  try {
    const current = await readActiveSession(dependencies, topicId, sessionId);
    const writing = current.writing;
    if (
      writing?.status !== 'completed' ||
      writing.sourceFingerprint !== sourceFingerprint ||
      writing.detailed?.status !== 'running'
    ) {
      return;
    }
    return dependencies.repository.failDetailedWriting({
      error: createCollectionError(
        'understanding',
        'detailed-writing',
        'UNDERSTANDING_DETAILED_WRITING_FAILED',
        true,
      ),
      feedbackRevision: writing.feedbackRevision ?? 0,
      generationRevision: writing.generationRevision ?? 0,
      sessionId,
      sourceFingerprint,
      topicId,
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
