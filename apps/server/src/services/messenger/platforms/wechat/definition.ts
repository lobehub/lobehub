import type { MessengerPlatformDefinition } from '../types';
import { MessengerWechatBinder } from './binder';
import { wechatWebhookGate } from './webhook';

export const wechat: MessengerPlatformDefinition = {
  connectionMode: 'polling',
  createBinder: (credentials) => new MessengerWechatBinder(credentials),
  id: 'wechat',
  name: 'WeChat',
  webhookGate: wechatWebhookGate,
};
