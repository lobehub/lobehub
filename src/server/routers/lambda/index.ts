/**
 * This file contains the root router of Lobe Chat tRPC-backend
 */
import { accountDeletionRouter } from '@/business/server/lambda-routers/accountDeletion';
import { referralRouter } from '@/business/server/lambda-routers/referral';
import { spendRouter } from '@/business/server/lambda-routers/spend';
import { subscriptionRouter } from '@/business/server/lambda-routers/subscription';
import { topUpRouter } from '@/business/server/lambda-routers/topUp';
import { publicProcedure, router } from '@/libs/trpc/lambda';

import { agentRouter } from './agent';
import { agentCronJobRouter } from './agentCronJob';
import { agentGroupRouter } from './agentGroup';
import { aiAgentRouter } from './aiAgent';
import { aiChatRouter } from './aiChat';
import { aiModelRouter } from './aiModel';
import { aiProviderRouter } from './aiProvider';
import { apiKeyRouter } from './apiKey';
import { chunkRouter } from './chunk';
import { comfyuiRouter } from './comfyui';
import { configRouter } from './config';
import { documentRouter } from './document';
import { exporterRouter } from './exporter';
import { fileRouter } from './file';
import { generationRouter } from './generation';
import { generationBatchRouter } from './generationBatch';
import { generationTopicRouter } from './generationTopic';
import { homeRouter } from './home';
import { imageRouter } from './image';
import { importerRouter } from './importer';
import { klavisRouter } from './klavis';
import { knowledgeBaseRouter } from './knowledgeBase';
import { marketRouter } from './market';
import { messageRouter } from './message';
import { notebookRouter } from './notebook';
import { oauthDeviceFlowRouter } from './oauthDeviceFlow';
import { pluginRouter } from './plugin';
import { ragEvalRouter } from './ragEval';
import { searchRouter } from './search';
import { sessionRouter } from './session';
import { sessionGroupRouter } from './sessionGroup';
import { shareRouter } from './share';
import { threadRouter } from './thread';
import { topicRouter } from './topic';
import { uploadRouter } from './upload';
import { usageRouter } from './usage';
import { userRouter } from './user';
import { userMemoriesRouter } from './userMemories';
import { userMemoryRouter } from './userMemory';

export const lambdaRouter = router({
  agent: agentRouter,
  agentCronJob: agentCronJobRouter,
  aiAgent: aiAgentRouter,
  aiChat: aiChatRouter,
  aiModel: aiModelRouter,
  aiProvider: aiProviderRouter,
  apiKey: apiKeyRouter,
  chunk: chunkRouter,
  comfyui: comfyuiRouter,
  config: configRouter,
  document: documentRouter,
  exporter: exporterRouter,
  file: fileRouter,
  generation: generationRouter,
  generationBatch: generationBatchRouter,
  generationTopic: generationTopicRouter,
  group: agentGroupRouter,
  healthcheck: publicProcedure.query(() => "i'm live!"),
  home: homeRouter,
  image: imageRouter,
  importer: importerRouter,
  klavis: klavisRouter,
  knowledgeBase: knowledgeBaseRouter,
  market: marketRouter,
  message: messageRouter,
  notebook: notebookRouter,
  oauthDeviceFlow: oauthDeviceFlowRouter,
  plugin: pluginRouter,
  ragEval: ragEvalRouter,
  search: searchRouter,
  session: sessionRouter,
  sessionGroup: sessionGroupRouter,
  share: shareRouter,
  thread: threadRouter,
  topic: topicRouter,
  upload: uploadRouter,
  usage: usageRouter,
  user: userRouter,
  userMemories: userMemoriesRouter,
  userMemory: userMemoryRouter,
  /* eslint-disable sort-keys-fix/sort-keys-fix */
  accountDeletion: accountDeletionRouter,
  referral: referralRouter,
  spend: spendRouter,
  subscription: subscriptionRouter,
  topUp: topUpRouter,
  /* eslint-enable sort-keys-fix/sort-keys-fix */
});

export type LambdaRouter = typeof lambdaRouter;
