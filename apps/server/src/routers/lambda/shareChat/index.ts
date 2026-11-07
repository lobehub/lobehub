import { mergeRouters } from '@/libs/trpc/lambda';

import { conversationRouter } from './conversation';
import { execRouter } from './exec';
import { gatewayRouter } from './gateway';
import { runControlRouter } from './runControl';
import { uploadRouter } from './upload';

export const shareChatRouter = mergeRouters(
  uploadRouter,
  execRouter,
  conversationRouter,
  runControlRouter,
  gatewayRouter,
);

export type ShareChatRouter = typeof shareChatRouter;
