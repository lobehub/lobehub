import debug from 'debug';

import { gatewayEnv } from '@/envs/gateway';

import type { MessengerPlatformWebhookGate } from '../types';

const log = debug('lobe-server:messenger:wechat:webhook-gate');

/**
 * WeChat polling events are forwarded by the trusted Message Gateway rather
 * than posted by WeChat itself. Require the gateway's service token before
 * any sender-controlled ids reach installation lookup or Chat SDK dispatch.
 */
export const wechatWebhookGate: MessengerPlatformWebhookGate = {
  preprocess: async (req) => {
    const serviceToken = gatewayEnv.MESSAGE_GATEWAY_SERVICE_TOKEN;
    if (!serviceToken) {
      log('webhook: MESSAGE_GATEWAY_SERVICE_TOKEN is not configured');
      return new Response('service not configured', { status: 503 });
    }

    if (req.headers.get('authorization') !== `Bearer ${serviceToken}`) {
      log('webhook: invalid Message Gateway authorization');
      return new Response('unauthorized', { status: 401 });
    }

    return null;
  },
};
