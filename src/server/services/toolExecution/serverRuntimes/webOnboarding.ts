import { WebOnboardingIdentifier } from '@lobechat/builtin-tool-web-onboarding';
import { WebOnboardingExecutionRuntime } from '@lobechat/builtin-tool-web-onboarding/executionRuntime';

import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { OnboardingService } from '@/server/services/onboarding';

import { type ServerRuntimeRegistration } from './types';

export const webOnboardingRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId || !context.serverDB) {
      throw new Error('userId and serverDB are required for Web Onboarding execution');
    }

    const onboardingService = new OnboardingService(context.serverDB, context.userId);
    const docService = new AgentDocumentsService(context.serverDB, context.userId);

    return new WebOnboardingExecutionRuntime({
      finishOnboarding: () => onboardingService.finishOnboarding(),

      getOnboardingState: () => onboardingService.getState(),

      readDocument: async (type) => {
        if (type === 'soul') {
          const inboxAgentId = await onboardingService.getInboxAgentId();
          const doc = await docService.getDocumentByFilename(inboxAgentId, 'SOUL.md');

          return {
            content: doc?.content ?? null,
            id: doc?.id ?? null,
          };
        }

        const { UserPersonaModel } = await import('@/database/models/userMemory/persona');
        const personaModel = new UserPersonaModel(context.serverDB!, context.userId!);
        const persona = await personaModel.getLatestPersonaDocument();

        return {
          content: persona?.persona ?? null,
          id: persona?.id ?? null,
        };
      },

      saveUserQuestion: (input) => onboardingService.saveUserQuestion(input),

      updateDocument: async (type, content) => {
        if (type === 'soul') {
          const inboxAgentId = await onboardingService.getInboxAgentId();
          const doc = await docService.upsertDocumentByFilename({
            agentId: inboxAgentId,
            content,
            filename: 'SOUL.md',
          });

          return { id: doc?.id ?? null };
        }

        const { UserPersonaModel } = await import('@/database/models/userMemory/persona');
        const personaModel = new UserPersonaModel(context.serverDB!, context.userId!);
        const result = await personaModel.upsertPersona({
          editedBy: 'agent_tool',
          persona: content,
          profile: 'default',
        });

        return { id: result.document.id };
      },
    });
  },
  identifier: WebOnboardingIdentifier,
};
