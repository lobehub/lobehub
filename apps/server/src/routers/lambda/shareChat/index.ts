import { router } from '@/libs/trpc/lambda';

import { conversationProcedures } from './conversation';
import { execProcedures } from './exec';
import { gatewayProcedures } from './gateway';
import { runControlProcedures } from './runControl';
import { uploadProcedures } from './upload';

export const shareChatRouter = router({
  ...uploadProcedures,
  ...execProcedures,
  ...conversationProcedures,
  ...runControlProcedures,
  ...gatewayProcedures,
});

export type ShareChatRouter = typeof shareChatRouter;
