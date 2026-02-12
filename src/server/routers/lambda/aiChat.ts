import { type SendMessageServerResponse } from '@lobechat/types';
import { AiSendMessageServerSchema, StructureOutputSchema } from '@lobechat/types';
import debug from 'debug';

import { LOADING_FLAT } from '@/const/message';
import { AgentModel } from '@/database/models/agent';
import { MessageModel } from '@/database/models/message';
import { ThreadModel } from '@/database/models/thread';
import { TopicModel } from '@/database/models/topic';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { resolveContext } from '@/server/routers/lambda/_helpers/resolveContext';
import { AiChatService } from '@/server/services/aiChat';
import { FileService } from '@/server/services/file';

const log = debug('lobe-lambda-router:ai-chat');

const aiChatProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      agentModel: new AgentModel(ctx.serverDB, ctx.userId),
      aiChatService: new AiChatService(ctx.serverDB, ctx.userId),
      fileService: new FileService(ctx.serverDB, ctx.userId),
      messageModel: new MessageModel(ctx.serverDB, ctx.userId),
      threadModel: new ThreadModel(ctx.serverDB, ctx.userId),
      topicModel: new TopicModel(ctx.serverDB, ctx.userId),
    },
  });
});

export const aiChatRouter = router({
  outputJSON: aiChatProcedure.input(StructureOutputSchema).mutation(async ({ input, ctx }) => {
    log('outputJSON called with provider: %s, model: %s', input.provider, input.model);
    log('messages count: %d', input.messages.length);
    log('schema: %O', input.schema);

    log('initializing model runtime from DB with provider: %s', input.provider);
    // Read user's provider config from database
    const modelRuntime = await initModelRuntimeFromDB(ctx.serverDB, ctx.userId, input.provider);

    log('calling generateObject');
    const result = await modelRuntime.generateObject({
      messages: input.messages,
      model: input.model,
      schema: input.schema,
      tools: input.tools,
    });

    log('generateObject completed, result: %O', result);
    return result;
  }),

  sendMessageInServer: aiChatProcedure
    .input(AiSendMessageServerSchema)
    .mutation(async ({ input, ctx }) => {
      log('sendMessageInServer called for agentId: %s', input.agentId);
      log(
        'topicId: %s, newTopic: %O, newThread: %O',
        input.topicId,
        input.newTopic,
        input.newThread,
      );
      let sessionId = input.sessionId;
      if (!sessionId) {
        const context = await resolveContext(input, ctx.serverDB, ctx.userId);
        if (!!context.sessionId) sessionId = context.sessionId;
      }

      let messageId: string;
      let topicId = input.topicId!;
      let threadId = input.threadId;
      let createdThreadId: string | undefined;

      let isCreateNewTopic = false;

      // create topic if there should be a new topic
      if (input.newTopic) {
        log('creating new topic with title: %s', input.newTopic.title);
        const topicItem = await ctx.topicModel.create({
          agentId: input.agentId,
          groupId: input.groupId,
          messages: input.newTopic.topicMessageIds,
          sessionId,
          title: input.newTopic.title,
        });
        topicId = topicItem.id;
        isCreateNewTopic = true;
        log('new topic created with id: %s', topicId);

        // update agent's updatedAt to reflect new activity
        if (input.agentId) {
          await ctx.agentModel.touchUpdatedAt(input.agentId);
          log('agent updatedAt touched for agentId: %s', input.agentId);
        }
      }

      // create thread if there should be a new thread
      if (input.newThread) {
        log(
          'creating new thread with sourceMessageId: %s, type: %s',
          input.newThread.sourceMessageId,
          input.newThread.type,
        );
        const threadItem = await ctx.threadModel.create({
          parentThreadId: input.newThread.parentThreadId,
          sourceMessageId: input.newThread.sourceMessageId,
          title: input.newThread.title,
          topicId,
          type: input.newThread.type,
        });
        if (threadItem) {
          threadId = threadItem.id;
          createdThreadId = threadItem.id;
          log('new thread created with id: %s', threadId);
        }
      }

      // create user message
      log('creating user message with content length: %d', input.newUserMessage.content.length);

      // Build user message metadata with pageSelections if present
      const userMessageMetadata = input.newUserMessage.pageSelections?.length
        ? { pageSelections: input.newUserMessage.pageSelections }
        : undefined;

      const userMessageItem = await ctx.messageModel.create({
        agentId: input.agentId,
        content: input.newUserMessage.content,
        files: input.newUserMessage.files,
        groupId: input.groupId,
        metadata: userMessageMetadata,
        parentId: input.newUserMessage.parentId,
        role: 'user',
        sessionId,
        threadId,
        topicId,
      });

      messageId = userMessageItem.id;
      log('user message created with id: %s', messageId);

      // create assistant message
      log(
        'creating assistant message with model: %s, provider: %s, metadata: %O',
        input.newAssistantMessage.model,
        input.newAssistantMessage.provider,
        input.newAssistantMessage.metadata,
      );
      const assistantMessageItem = await ctx.messageModel.create({
        agentId: input.agentId,
        content: LOADING_FLAT,
        groupId: input.groupId,
        metadata: input.newAssistantMessage.metadata,
        model: input.newAssistantMessage.model,
        parentId: messageId,
        provider: input.newAssistantMessage.provider,
        role: 'assistant',
        sessionId,
        threadId,
        topicId,
      });
      log('assistant message created with id: %s', assistantMessageItem.id);

      // retrieve latest messages and topic with
      log('retrieving messages and topics');
      const { messages, topics } = await ctx.aiChatService.getMessagesAndTopics({
        agentId: input.agentId,
        groupId: input.groupId,
        includeTopic: isCreateNewTopic,
        sessionId,
        threadId,
        topicId,
      });

      log('retrieved %d messages, %d topics', messages.length, topics?.items?.length ?? 0);

      return {
        assistantMessageId: assistantMessageItem.id,
        createdThreadId,
        isCreateNewTopic,
        messages,
        topicId,
        topics,
        userMessageId: messageId,
      } as SendMessageServerResponse;
    }),
});
