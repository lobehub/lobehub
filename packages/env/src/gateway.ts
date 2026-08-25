import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const getGatewayConfig = () => {
  return createEnv({
    runtimeEnv: {
      DEVICE_GATEWAY_SERVICE_TOKEN: process.env.DEVICE_GATEWAY_SERVICE_TOKEN,
      DEVICE_GATEWAY_URL: process.env.DEVICE_GATEWAY_URL,
      MESSAGE_GATEWAY_ENABLED: process.env.MESSAGE_GATEWAY_ENABLED,
      MESSAGE_GATEWAY_NODE_PLATFORMS: process.env.MESSAGE_GATEWAY_NODE_PLATFORMS,
      MESSAGE_GATEWAY_NODE_URL: process.env.MESSAGE_GATEWAY_NODE_URL,
      MESSAGE_GATEWAY_SERVICE_TOKEN: process.env.MESSAGE_GATEWAY_SERVICE_TOKEN,
      MESSAGE_GATEWAY_URL: process.env.MESSAGE_GATEWAY_URL,
    },

    server: {
      DEVICE_GATEWAY_SERVICE_TOKEN: z.string().optional(),
      DEVICE_GATEWAY_URL: z.string().url().optional(),
      MESSAGE_GATEWAY_ENABLED: z.string().optional(),
      /**
       * Comma-separated platform ids whose gateway connections live on the
       * Node message gateway instead of the default one (e.g. `wechat`).
       * Doubles as the migration/rollback switch: remove a platform from the
       * list and the next reconcile moves its connections back.
       */
      MESSAGE_GATEWAY_NODE_PLATFORMS: z.string().optional(),
      /**
       * Base URL of the Node message gateway (long-polling / native-dep
       * platforms). Both gateways share MESSAGE_GATEWAY_SERVICE_TOKEN — the
       * inbound webhook/callback validation only accepts that one value, so a
       * per-gateway token would not actually isolate anything.
       */
      MESSAGE_GATEWAY_NODE_URL: z.string().url().optional(),
      MESSAGE_GATEWAY_SERVICE_TOKEN: z.string().optional(),
      MESSAGE_GATEWAY_URL: z.string().url().optional(),
    },
  });
};

export const gatewayEnv = getGatewayConfig();
