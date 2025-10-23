import {
  AiSendMessageServerSchema,
  SendMessageServerResponse,
  StructureOutputSchema,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';

import { LOADING_FLAT } from '@/const/message';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { initModelRuntimeWithUserPayload } from '@/server/modules/ModelRuntime';
import { AiChatService } from '@/server/services/aiChat';
import { FileService } from '@/server/services/file';
import { getXorPayload } from '@/utils/server';

const log = debug('lobe-lambda-router:ai-chat');

const aiChatProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      aiChatService: new AiChatService(ctx.serverDB, ctx.userId),
      fileService: new FileService(ctx.serverDB, ctx.userId),
      messageModel: new MessageModel(ctx.serverDB, ctx.userId),
      topicModel: new TopicModel(ctx.serverDB, ctx.userId),
    },
  });
});

export const aiChatRouter = router({
  outputJSON: aiChatProcedure.input(StructureOutputSchema).mutation(async ({ input }) => {
    log('outputJSON called with provider: %s, model: %s', input.provider, input.model);
    log('messages count: %d', input.messages.length);
    log('schema: %O', input.schema);

    let payload: object | undefined;

    try {
      payload = getXorPayload(input.keyVaultsPayload);
      log('payload parsed successfully');
    } catch (e) {
      log('payload parse error: %O', e);
      console.warn('user payload parse error', e);
    }

    if (!payload) {
      log('payload is empty, throwing error');
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'keyVaultsPayload is not correct' });
    }

    log('initializing model runtime with provider: %s', input.provider);
    const modelRuntime = initModelRuntimeWithUserPayload(input.provider, payload);

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
      log('sendMessageInServer called for sessionId: %s', input.sessionId);
      log('topicId: %s, newTopic: %O', input.topicId, input.newTopic);

      let messageId: string;
      let topicId = input.topicId!;

      let isCreateNewTopic = false;

      // create topic if there should be a new topic
      if (input.newTopic) {
        log('creating new topic with title: %s', input.newTopic.title);
        const topicItem = await ctx.topicModel.create({
          messages: input.newTopic.topicMessageIds,
          sessionId: input.sessionId,
          title: input.newTopic.title,
        });
        topicId = topicItem.id;
        isCreateNewTopic = true;
        log('new topic created with id: %s', topicId);
      }

      // create user message
      log('creating user message with content length: %d', input.newUserMessage.content.length);
      const userMessageItem = await ctx.messageModel.create({
        content: input.newUserMessage.content,
        files: input.newUserMessage.files,
        role: 'user',
        sessionId: input.sessionId!,
        threadId: input.threadId,
        topicId,
      });

      messageId = userMessageItem.id;
      log('user message created with id: %s', messageId);

      // create assistant message
      log(
        'creating assistant message with model: %s, provider: %s',
        input.newAssistantMessage.model,
        input.newAssistantMessage.provider,
      );
      const assistantMessageItem = await ctx.messageModel.create({
        content: LOADING_FLAT,
        fromModel: input.newAssistantMessage.model,
        fromProvider: input.newAssistantMessage.provider,
        parentId: messageId,
        role: 'assistant',
        sessionId: input.sessionId!,
        threadId: input.threadId,
        topicId,
      });
      log('assistant message created with id: %s', assistantMessageItem.id);

      // retrieve latest messages and topic with
      log('retrieving messages and topics');
      const { messages, topics } = await ctx.aiChatService.getMessagesAndTopics({
        includeTopic: isCreateNewTopic,
        sessionId: input.sessionId,
        topicId,
      });

      log('retrieved %d messages, %d topics', messages.length, topics?.length ?? 0);

      return {
        assistantMessageId: assistantMessageItem.id,
        isCreateNewTopic,
        messages,
        topicId,
        topics,
        userMessageId: messageId,
      } as SendMessageServerResponse;
    }),
});
