import { router } from '@/libs/trpc/lambda';

import { bindingOptionsProcedures } from './bindingOptions';
import { installationsProcedures } from './installations';
import { linksProcedures } from './links';
import { linkTokenProcedures } from './linkToken';
import { linqProcedures } from './linq';
import { pushProcedures } from './push';
import { wechatProcedures } from './wechat';

export const messengerRouter = router({
  ...bindingOptionsProcedures,
  ...wechatProcedures,
  ...linqProcedures,
  ...linkTokenProcedures,
  ...linksProcedures,
  ...pushProcedures,
  ...installationsProcedures,
});
