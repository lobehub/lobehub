import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    interface ProcessEnv {
      /**
       * When `1`, OTP codes are also logged via the debug SMS impl (local QA).
       */
      AUTH_SMS_DEBUG_OTP?: string;
      KAVENEGAR_API_KEY?: string;
      /**
       * Kavenegar Verify Lookup template name (panel → اعتبارسنجی).
       * When set, OTP uses `/verify/lookup.json`; otherwise `/sms/send.json`.
       * @see https://kavenegar.com/rest.html
       */
      KAVENEGAR_OTP_TEMPLATE?: string;
      /**
       * Optional sender line for `/sms/send` (e.g. `10004346`).
       * Unused by `/verify/lookup` (uses the line bound to the template).
       */
      KAVENEGAR_SENDER?: string;
    }
  }
}

export const getSmsConfig = () => {
  return createEnv({
    server: {
      AUTH_SMS_DEBUG_OTP: z.boolean().optional().default(false),
      KAVENEGAR_API_KEY: z.string().optional(),
      KAVENEGAR_OTP_TEMPLATE: z.string().optional(),
      KAVENEGAR_SENDER: z.string().optional(),
    },
    runtimeEnv: {
      AUTH_SMS_DEBUG_OTP: process.env.AUTH_SMS_DEBUG_OTP === '1',
      KAVENEGAR_API_KEY: process.env.KAVENEGAR_API_KEY,
      KAVENEGAR_OTP_TEMPLATE: process.env.KAVENEGAR_OTP_TEMPLATE,
      KAVENEGAR_SENDER: process.env.KAVENEGAR_SENDER,
    },
  });
};

export const smsEnv = getSmsConfig();
