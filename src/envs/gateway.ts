import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const getGatewayConfig = () => {
  return createEnv({
    runtimeEnv: {
      DEVICE_GATEWAY_SERVICE_TOKEN: process.env.DEVICE_GATEWAY_SERVICE_TOKEN,
      DEVICE_GATEWAY_URL: process.env.DEVICE_GATEWAY_URL,
    },

    server: {
      DEVICE_GATEWAY_SERVICE_TOKEN: z.string().optional(),
      DEVICE_GATEWAY_URL: z.string().url().optional(),
    },
  });
};

export const gatewayEnv = getGatewayConfig();
