import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    interface ProcessEnv {
      AUTO_REGISTER_ON_PHONE_LOGIN?: string;
      SMS_APP_KEY?: string;
      SMS_CODE_TTL?: string;
      SMS_MASTER_SECRET?: string;
      SMS_PHONE_RESEND_INTERVAL?: string;
      SMS_SIGN_ID?: string;
      SMS_TEMPLATE_CODE_PARAM?: string;
      SMS_TEMPLATE_ID?: string;
    }
  }
}

export const getSMSConfig = () => {
  return createEnv({
    server: {
      AUTO_REGISTER_ON_PHONE_LOGIN: z.boolean().optional().default(false),
      SMS_APP_KEY: z.string().optional(),
      SMS_CODE_TTL: z.coerce.number().int().min(60).max(1800).optional().default(300),
      SMS_MASTER_SECRET: z.string().optional(),
      SMS_PHONE_RESEND_INTERVAL: z.coerce.number().int().min(30).max(600).optional().default(60),
      SMS_SIGN_ID: z.coerce.number().int().positive().optional(),
      SMS_TEMPLATE_CODE_PARAM: z.string().optional().default('code'),
      SMS_TEMPLATE_ID: z.coerce.number().int().positive().optional(),
    },
    runtimeEnv: {
      AUTO_REGISTER_ON_PHONE_LOGIN:
        process.env.AUTO_REGISTER_ON_PHONE_LOGIN === '1' ||
        process.env.AUTO_REGISTER_ON_PHONE_LOGIN === 'true',
      SMS_APP_KEY: process.env.SMS_APP_KEY,
      SMS_CODE_TTL: process.env.SMS_CODE_TTL,
      SMS_MASTER_SECRET: process.env.SMS_MASTER_SECRET,
      SMS_PHONE_RESEND_INTERVAL: process.env.SMS_PHONE_RESEND_INTERVAL,
      SMS_SIGN_ID: process.env.SMS_SIGN_ID,
      SMS_TEMPLATE_CODE_PARAM: process.env.SMS_TEMPLATE_CODE_PARAM,
      SMS_TEMPLATE_ID: process.env.SMS_TEMPLATE_ID,
    },
  });
};

export const smsEnv = getSMSConfig();

export const isPhoneAuthEnabled =
  !!smsEnv.SMS_APP_KEY && !!smsEnv.SMS_MASTER_SECRET && !!smsEnv.SMS_TEMPLATE_ID;
