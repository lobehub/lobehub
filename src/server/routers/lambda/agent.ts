import { DEFAULT_AGENT_CONFIG, INBOX_SESSION_ID } from '@lobechat/const';
import { type KnowledgeItem } from '@lobechat/types';
import { KnowledgeType } from '@lobechat/types';
import { z } from 'zod';

import { AgentModel } from '@/database/models/agent';
import { ChatGroupModel } from '@/database/models/chatGroup';
import { FileModel } from '@/database/models/file';
import { KnowledgeBaseModel } from '@/database/models/knowledgeBase';
import { SessionModel } from '@/database/models/session';
import { UserModel } from '@/database/models/user';
import { insertAgentSchema } from '@/database/schemas';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { AgentService } from '@/server/services/agent';

const agentProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      agentModel: new AgentModel(ctx.serverDB, ctx.userId),
      agentService: new AgentService(ctx.serverDB, ctx.userId),
      chatGroupModel: new ChatGroupModel(ctx.serverDB, ctx.userId),
      fileModel: new FileModel(ctx.serverDB, ctx.userId),
      knowledgeBaseModel: new KnowledgeBaseModel(ctx.serverDB, ctx.userId),
      sessionModel: new SessionModel(ctx.serverDB, ctx.userId),
    },
  });
});

export const agentRouter = router({
  /**
   * Check if an agent with the given marketIdentifier already exists
   */
  checkByMarketIdentifier: agentProcedure
    .input(
      z.object({
        marketIdentifier: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.agentModel.checkByMarketIdentifier(input.marketIdentifier);
    }),

  /**
   * Create a new agent with session
   * Returns the created agent ID and session ID
   */
  createAgent: agentProcedure
    .input(
      z.object({
        config: insertAgentSchema
          .omit({
            chatConfig: true,
            openingMessage: true,
            openingQuestions: true,
            plugins: true,
            tags: true,
            tts: true,
          })
          .passthrough()
          .partial()
          .optional(),
        groupId: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const session = await ctx.sessionModel.create({
        config: input.config,
        session: { groupId: input.groupId },
        type: 'agent',
      });

      // Get the agent ID from the created session
      const sessionWithAgent = await ctx.sessionModel.findByIdOrSlug(session.id);
      const agentId = sessionWithAgent?.agent?.id;

      return {
        agentId,
        sessionId: session.id,
      };
    }),

  createAgentFiles: agentProcedure
    .input(
      z.object({
        agentId: z.string(),
        enabled: z.boolean().optional(),
        fileIds: z.array(z.string()),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.agentModel.createAgentFiles(input.agentId, input.fileIds, input.enabled);
    }),

  createAgentKnowledgeBase: agentProcedure
    .input(
      z.object({
        agentId: z.string(),
        enabled: z.boolean().optional(),
        knowledgeBaseId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.agentModel.createAgentKnowledgeBase(
        input.agentId,
        input.knowledgeBaseId,
        input.enabled,
      );
    }),

  /**
   * Create an agent without session.
   * Used for Group Agent Builder to create agents for groups.
   * Returns only the agent ID.
   */
  createAgentOnly: agentProcedure
    .input(
      z.object({
        config: z.object({}).passthrough().optional(),
        groupId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Create the agent entity only (no session)
      const agent = await ctx.agentModel.create(input.config ?? {});

      // Add the agent to the group
      await ctx.chatGroupModel.addAgentToGroup(input.groupId, agent.id);

      return { agentId: agent.id };
    }),

  deleteAgentFile: agentProcedure
    .input(
      z.object({
        agentId: z.string(),
        fileId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.agentModel.deleteAgentFile(input.agentId, input.fileId);
    }),

  deleteAgentKnowledgeBase: agentProcedure
    .input(
      z.object({
        agentId: z.string(),
        knowledgeBaseId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.agentModel.deleteAgentKnowledgeBase(input.agentId, input.knowledgeBaseId);
    }),

  /**
   * Duplicate an agent and its associated session.
   * Returns the new agent ID and session ID.
   */
  duplicateAgent: agentProcedure
    .input(
      z.object({
        agentId: z.string(),
        newTitle: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.agentModel.duplicate(input.agentId, input.newTitle);
    }),

  /**
   * Get an agent by forkedFromIdentifier stored in params
   * @returns agent id if exists, null otherwise
   */
  getAgentByForkedFromIdentifier: agentProcedure
    .input(
      z.object({
        forkedFromIdentifier: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.agentModel.getAgentByForkedFromIdentifier(input.forkedFromIdentifier);
    }),

  /**
   * Get an agent by marketIdentifier
   * @returns agent id if exists, null otherwise
   */
  getAgentByMarketIdentifier: agentProcedure
    .input(
      z.object({
        marketIdentifier: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.agentModel.getAgentByMarketIdentifier(input.marketIdentifier);
    }),

  getAgentConfig: agentProcedure
    .input(
      z.object({
        sessionId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      if (input.sessionId === INBOX_SESSION_ID) {
        const item = await ctx.sessionModel.findByIdOrSlug(INBOX_SESSION_ID);
        // if there is no session for user, create one
        if (!item) {
          // if there is no user, return default config
          const user = await UserModel.findById(ctx.serverDB, ctx.userId);
          if (!user) return DEFAULT_AGENT_CONFIG;

          const res = await ctx.agentService.createInbox();
          console.log('create inbox session', res);
        }
      }

      const session = await ctx.sessionModel.findByIdOrSlug(input.sessionId);

      if (!session) throw new Error(`Session [${input.sessionId}] not found`);
      const sessionId = session.id;

      return ctx.agentModel.findBySessionId(sessionId);
    }),

  getAgentConfigById: agentProcedure
    .input(
      z.object({
        agentId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.agentService.getAgentConfigById(input.agentId);
    }),

  /**
   * Get a builtin agent by slug, creating it if it doesn't exist.
   * This is a generic interface for all builtin agents (page-copilot, inbox, etc.)
   */
  getBuiltinAgent: agentProcedure
    .input(
      z.object({
        slug: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.agentService.getBuiltinAgent(input.slug);
    }),

  getKnowledgeBasesAndFiles: agentProcedure
    .input(
      z.object({
        agentId: z.string(),
      }),
    )
    .query(async ({ ctx, input }): Promise<KnowledgeItem[]> => {
      const knowledgeBases = await ctx.knowledgeBaseModel.query();

      const files = await ctx.fileModel.query({
        showFilesInKnowledgeBase: false,
      });

      const knowledge = await ctx.agentModel.getAgentAssignedKnowledge(input.agentId);

      return [
        ...files
          // Filter out all images
          .filter((file) => !file.fileType.startsWith('image'))
          .map((file) => ({
            enabled: knowledge.files.some((item) => item.id === file.id),
            fileType: file.fileType,
            id: file.id,
            name: file.name,
            type: KnowledgeType.File,
          })),
        ...knowledgeBases.map((knowledgeBase) => ({
          avatar: knowledgeBase.avatar,
          description: knowledgeBase.description,
          enabled: knowledge.knowledgeBases.some((item) => item.id === knowledgeBase.id),
          id: knowledgeBase.id,
          name: knowledgeBase.name,
          type: KnowledgeType.KnowledgeBase,
        })),
      ];
    }),

  /**
   * Query non-virtual agents with optional keyword filter.
   * Returns agents with minimal info (id, title, description, avatar, backgroundColor).
   * Used by AddGroupMemberModal and group-management tool to search/select agents.
   */
  queryAgents: agentProcedure
    .input(
      z
        .object({
          keyword: z.string().optional(),
          limit: z.number().optional(),
          offset: z.number().optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      return ctx.agentModel.queryAgents(input);
    }),

  /**
   * Remove an agent and its associated session
   */
  removeAgent: agentProcedure
    .input(z.object({ agentId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.agentModel.delete(input.agentId);
    }),

  toggleFile: agentProcedure
    .input(
      z.object({
        agentId: z.string(),
        enabled: z.boolean().optional(),
        fileId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.agentModel.toggleFile(input.agentId, input.fileId, input.enabled);
    }),

  toggleKnowledgeBase: agentProcedure
    .input(
      z.object({
        agentId: z.string(),
        enabled: z.boolean().optional(),
        knowledgeBaseId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.agentModel.toggleKnowledgeBase(
        input.agentId,
        input.knowledgeBaseId,
        input.enabled,
      );
    }),

  updateAgentConfig: agentProcedure
    .input(
      z.object({
        agentId: z.string(),
        value: z.object({}).passthrough().partial(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Use AgentService to update and return the updated agent data
      return ctx.agentService.updateAgentConfig(input.agentId, input.value);
    }),

  /**
   * Pin or unpin an agent
   */
  updateAgentPinned: agentProcedure
    .input(
      z.object({
        id: z.string(),
        pinned: z.boolean(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.agentModel.update(input.id, { pinned: input.pinned });
    }),
});
