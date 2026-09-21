import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const getGatewayConfig = () => {
  return createEnv({
    runtimeEnv: {
      DEVICE_GATEWAY_SERVICE_TOKEN: process.env.DEVICE_GATEWAY_SERVICE_TOKEN,
      DEVICE_GATEWAY_URL: process.env.DEVICE_GATEWAY_URL,
      MESSAGE_GATEWAY_ENABLED: process.env.MESSAGE_GATEWAY_ENABLED,
      MESSAGE_GATEWAY_NODE_PLATFORMS: process.env.MESSAGE_GATEWAY_NODE_PLATFORMS,
      MESSAGE_GATEWAY_NODE_PULL_TOKEN: process.env.MESSAGE_GATEWAY_NODE_PULL_TOKEN,
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
       * Credential the Node gateway presents to pull the connections it should
       * be holding. One credential, one host: presenting it IS the claim of
       * which gateway is asking, which is what lets the server answer that
       * question without trusting a field the caller filled in. A second
       * pull-capable host gets its own credential here, never a share of this
       * one.
       *
       * Deliberately not MESSAGE_GATEWAY_SERVICE_TOKEN. That value is written
       * into every WeChat connect payload as `webhookToken` and persisted with
       * the connection config, so it lives in the gateway fleet's storage, not
       * just in two env vars. Manipulating connections with it is the exposure
       * we already accept; reading every credential in one request is not.
       */
      MESSAGE_GATEWAY_NODE_PULL_TOKEN: z.string().optional(),
      /**
       * Base URL of the Node message gateway (long-polling / native-dep
       * platforms). Both gateways share MESSAGE_GATEWAY_SERVICE_TOKEN for the
       * connection-management surface, because inbound webhook and callback
       * validation only accepts that one value.
       */
      MESSAGE_GATEWAY_NODE_URL: z.string().url().optional(),
      MESSAGE_GATEWAY_SERVICE_TOKEN: z.string().optional(),
      MESSAGE_GATEWAY_URL: z.string().url().optional(),
    },
  });
};

export const gatewayEnv = getGatewayConfig();
