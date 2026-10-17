import {
  EMPTY_DOCUMENT_MESSAGES,
  formatWebOnboardingStateMessage,
} from '@lobechat/builtin-tool-web-onboarding/utils';
import { applyMarkdownPatch, formatMarkdownPatchError } from '@lobechat/markdown-patch';
import {
  SaveUserQuestionInputSchema,
  UserAgentOnboardingSchema,
  UserOnboardingSchema,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { UserPersonaModel } from '@/database/models/userMemory/persona';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { OnboardingService } from '@/server/services/onboarding';

import { userProcedure } from './procedures';

export const onboardingProcedures = {
  getOrCreateOnboardingState: userProcedure.query(async ({ ctx }) => {
    const onboardingService = new OnboardingService(ctx.serverDB, ctx.userId);

    return onboardingService.getOrCreateState();
  }),
  getOnboardingBootstrapState: userProcedure.query(async ({ ctx }) => {
    const onboardingService = new OnboardingService(ctx.serverDB, ctx.userId);

    return onboardingService.getBootstrapState();
  }),
  sendOnboardingFirstMessage: userProcedure
    .input(z.object({ agentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const onboardingService = new OnboardingService(ctx.serverDB, ctx.userId);

      return onboardingService.sendOnboardingFirstMessage(input);
    }),
  getOnboardingAgentContext: userProcedure.query(async ({ ctx }) => {
    const onboardingService = new OnboardingService(ctx.serverDB, ctx.userId);
    const docService = new AgentDocumentsService(
      ctx.serverDB,
      ctx.userId,
      ctx.workspaceId ?? undefined,
    );
    const personaModel = new UserPersonaModel(ctx.serverDB, ctx.userId);

    const [state, soulDoc, persona, userInfo] = await Promise.all([
      onboardingService.getState(),
      onboardingService
        .getInboxAgentId()
        .then((inboxAgentId) => docService.getDocumentByFilename(inboxAgentId, 'SOUL.md'))
        .catch(() => null),
      personaModel.getLatestPersonaDocument().catch(() => null),
      onboardingService.getInitialUserInfo().catch(() => undefined),
    ]);

    return {
      discoveryUserMessageCount: state.discoveryUserMessageCount,
      personaContent: persona?.persona || null,
      phaseGuidance: formatWebOnboardingStateMessage(state),
      remainingDiscoveryExchanges: state.remainingDiscoveryExchanges,
      soulContent: soulDoc?.content || null,
      userInfo,
    };
  }),
  saveUserQuestion: userProcedure
    .input(SaveUserQuestionInputSchema)
    .mutation(async ({ ctx, input }) => {
      const onboardingService = new OnboardingService(ctx.serverDB, ctx.userId);

      return onboardingService.saveUserQuestion(input);
    }),
  finishOnboarding: userProcedure.input(z.object({})).mutation(async ({ ctx, input }) => {
    const onboardingService = new OnboardingService(ctx.serverDB, ctx.userId);
    void input;

    return onboardingService.finishOnboarding();
  }),
  readOnboardingDocument: userProcedure
    .input(z.object({ type: z.enum(['soul', 'persona']) }))
    .query(async ({ ctx, input }) => {
      if (input.type === 'soul') {
        const onboardingService = new OnboardingService(ctx.serverDB, ctx.userId);
        const docService = new AgentDocumentsService(
          ctx.serverDB,
          ctx.userId,
          ctx.workspaceId ?? undefined,
        );
        const inboxAgentId = await onboardingService.getInboxAgentId();
        const doc = await docService.getDocumentByFilename(inboxAgentId, 'SOUL.md');

        return {
          content: doc?.content || EMPTY_DOCUMENT_MESSAGES.soul,
          id: doc?.id ?? null,
          type: 'soul' as const,
        };
      }

      const personaModel = new UserPersonaModel(ctx.serverDB, ctx.userId);
      const persona = await personaModel.getLatestPersonaDocument();

      return {
        content: persona?.persona || EMPTY_DOCUMENT_MESSAGES.persona,
        id: persona?.id ?? null,
        type: 'persona' as const,
      };
    }),
  updateOnboardingDocument: userProcedure
    .input(z.object({ content: z.string(), type: z.enum(['soul', 'persona']) }))
    .mutation(async ({ ctx, input }) => {
      if (input.type === 'soul') {
        const onboardingService = new OnboardingService(ctx.serverDB, ctx.userId);
        const docService = new AgentDocumentsService(
          ctx.serverDB,
          ctx.userId,
          ctx.workspaceId ?? undefined,
        );
        const inboxAgentId = await onboardingService.getInboxAgentId();
        const doc = await docService.upsertDocumentByFilename({
          agentId: inboxAgentId,
          content: input.content,
          filename: 'SOUL.md',
        });

        return { id: doc?.id, type: 'soul' as const };
      }

      const personaModel = new UserPersonaModel(ctx.serverDB, ctx.userId);
      const result = await personaModel.upsertPersona({
        editedBy: 'agent_tool',
        persona: input.content,
        profile: 'default',
      });

      return { id: result.document.id, type: 'persona' as const };
    }),
  patchOnboardingDocument: userProcedure
    .input(
      z.object({
        hunks: z
          .array(
            z.union([
              z.object({
                mode: z.literal('replace').optional(),
                replace: z.string(),
                replaceAll: z.boolean().optional(),
                search: z.string(),
              }),
              z.object({
                mode: z.literal('delete'),
                replaceAll: z.boolean().optional(),
                search: z.string(),
              }),
              z.object({
                endLine: z.number().int(),
                mode: z.literal('deleteLines'),
                startLine: z.number().int(),
              }),
              z.object({
                content: z.string(),
                line: z.number().int(),
                mode: z.literal('insertAt'),
              }),
              z.object({
                content: z.string(),
                endLine: z.number().int(),
                mode: z.literal('replaceLines'),
                startLine: z.number().int(),
              }),
            ]),
          )
          .min(1),
        type: z.enum(['soul', 'persona']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const readCurrent = async (): Promise<string> => {
        if (input.type === 'soul') {
          const onboardingService = new OnboardingService(ctx.serverDB, ctx.userId);
          const docService = new AgentDocumentsService(
            ctx.serverDB,
            ctx.userId,
            ctx.workspaceId ?? undefined,
          );
          const inboxAgentId = await onboardingService.getInboxAgentId();
          const doc = await docService.getDocumentByFilename(inboxAgentId, 'SOUL.md');
          return doc?.content ?? '';
        }

        const personaModel = new UserPersonaModel(ctx.serverDB, ctx.userId);
        const persona = await personaModel.getLatestPersonaDocument();
        return persona?.persona ?? '';
      };

      const current = await readCurrent();
      const patched = applyMarkdownPatch(current, input.hunks);
      if (!patched.ok) {
        throw new TRPCError({
          cause: patched.error,
          code: 'BAD_REQUEST',
          message: formatMarkdownPatchError(patched.error),
        });
      }

      if (input.type === 'soul') {
        const onboardingService = new OnboardingService(ctx.serverDB, ctx.userId);
        const docService = new AgentDocumentsService(
          ctx.serverDB,
          ctx.userId,
          ctx.workspaceId ?? undefined,
        );
        const inboxAgentId = await onboardingService.getInboxAgentId();
        const doc = await docService.upsertDocumentByFilename({
          agentId: inboxAgentId,
          content: patched.content,
          filename: 'SOUL.md',
        });

        return { applied: patched.applied, id: doc?.id, type: 'soul' as const };
      }

      const personaModel = new UserPersonaModel(ctx.serverDB, ctx.userId);
      const result = await personaModel.upsertPersona({
        editedBy: 'agent_tool',
        persona: patched.content,
        profile: 'default',
      });

      return { applied: patched.applied, id: result.document.id, type: 'persona' as const };
    }),
  resetAgentOnboarding: userProcedure.mutation(async ({ ctx }) => {
    return ctx.createOnboardingService().reset();
  }),
  updateAgentOnboarding: userProcedure
    .input(UserAgentOnboardingSchema)
    .mutation(async ({ ctx, input }) => {
      return ctx.userModel.updateUser({ agentOnboarding: input });
    }),
  updateOnboarding: userProcedure.input(UserOnboardingSchema).mutation(async ({ ctx, input }) => {
    return ctx.createOnboardingService().updateOnboarding(input);
  }),
};
