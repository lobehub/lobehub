import { mergeRouters } from '@/libs/trpc/lambda';

import { bindingOptionsRouter } from './bindingOptions';
import { installationsRouter } from './installations';
import { linksRouter } from './links';
import { linkTokenRouter } from './linkToken';
import { linqRouter } from './linq';
import { pushRouter } from './push';
import { wechatRouter } from './wechat';

export const messengerRouter = mergeRouters(
  bindingOptionsRouter,
  wechatRouter,
  linqRouter,
  linkTokenRouter,
  linksRouter,
  pushRouter,
  installationsRouter,
);
