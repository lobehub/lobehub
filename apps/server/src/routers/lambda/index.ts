import { accountDeletionRouter } from '@/business/server/lambda-routers/accountDeletion';
import { pageShareRouter } from '@/business/server/lambda-routers/pageShare';
import { referralRouter } from '@/business/server/lambda-routers/referral';
import { spendRouter } from '@/business/server/lambda-routers/spend';
import { storageOverageRouter } from '@/business/server/lambda-routers/storageOverage';
import { subscriptionRouter } from '@/business/server/lambda-routers/subscription';
import { taskTemplateRouter } from '@/business/server/lambda-routers/taskTemplate';
import { topUpRouter } from '@/business/server/lambda-routers/topUp';
import { workspaceRouter } from '@/business/server/lambda-routers/workspace';
import { workspaceAuditLogRouter } from '@/business/server/lambda-routers/workspaceAuditLog';
import { workspaceCreditsRouter } from '@/business/server/lambda-routers/workspaceCredits';
import { workspaceCredsRouter } from '@/business/server/lambda-routers/workspaceCreds';
import { workspaceDataRouter } from '@/business/server/lambda-routers/workspaceData';
import { workspaceMemberRouter } from '@/business/server/lambda-routers/workspaceMember';
import { workspaceUsageRouter } from '@/business/server/lambda-routers/workspaceUsage';
import { publicProcedure, router } from '@/libs/trpc/lambda';

import { agentRouter } from './agent';
import { agentBotProviderRouter } from './agentBotProvider';
import { agentDocumentRouter } from './agentDocument';
import { agentEvalRouter } from './agentEval';
import { agentEvalExternalRouter } from './agentEvalExternal';
import { agentGroupRouter } from './agentGroup';
import { agentNotifyRouter } from './agentNotify';
import { agentSignalRouter } from './agentSignal';
import { agentSkillsRouter } from './agentSkills';
import { aiAgentRouter } from './aiAgent';
import { aiChatRouter } from './aiChat';
import { aiModelRouter } from './aiModel';
import { aiProviderRouter } from './aiProvider';
import { apiKeyRouter } from './apiKey';
import { asrRouter } from './asr';
import { botMessageRouter } from './botMessage';
import { briefRouter } from './brief';
import { changelogRouter } from './changelog';
import { chunkRouter } from './chunk';
import { comfyuiRouter } from './comfyui';
import { composioRouter } from './composio';
import { configRouter } from './config';
import { connectorRouter } from './connector';
import { deviceRouter } from './device';
import { documentRouter } from './document';
import { exporterRouter } from './exporter';
import { fileRouter } from './file';
import { followUpActionRouter } from './followUpAction';
import { generationRouter } from './generation';
import { generationBatchRouter } from './generationBatch';
import { generationTopicRouter } from './generationTopic';
import { homeRouter } from './home';
import { imageRouter } from './image';
import { importerRouter } from './importer';
import { klavisRouter } from './klavis';
import { knowledgeRouter } from './knowledge';
import { knowledgeBaseRouter } from './knowledgeBase';
import { llmGenerationTracingRouter } from './llmGenerationTracing';
import { marketRouter } from './market';
import { messageRouter } from './message';
import { messengerRouter } from './messenger';
import { notebookRouter } from './notebook';
import { notificationRouter } from './notification';
import { oauthDeviceFlowRouter } from './oauthDeviceFlow';
import { pluginRouter } from './plugin';
import { pushTokenRouter } from './pushToken';
import { ragEvalRouter } from './ragEval';
import { recentRouter } from './recent';
import { searchRouter } from './search';
import { sessionRouter } from './session';
import { sessionGroupRouter } from './sessionGroup';
import { shareRouter } from './share';
import { taskRouter } from './task';
import { threadRouter } from './thread';
import { topicRouter } from './topic';
import { uploadRouter } from './upload';
import { usageRouter } from './usage';
import { userRouter } from './user';
import { userMemoriesRouter } from './userMemories';
import { userMemoryRouter } from './userMemory';
import { verifyRouter } from './verify';
import { videoRouter } from './video';
import { webBrowsingRouter } from './webBrowsing';
+import { adminRolesRouter } from './adminRoles';
 
 export const lambdaRouter = router({
   agent: agentRouter,
@@
   webBrowsing: webBrowsingRouter,
+  adminRoles: adminRolesRouter,
   workspace: workspaceRouter,
