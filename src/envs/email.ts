/* eslint-disable sort-keys-fix/sort-keys-fix */
import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    interface ProcessEnv {
      EMAIL_SERVICE_PROVIDER?: string;
      RESEND_API_KEY?: string;
      RESEND_FROM?: string;
      SMTP_FROM?: string;
      SMTP_HOST?: string;
      SMTP_PASS?: string;
      SMTP_PORT?: string;
      SMTP_SECURE?: string;
      SMTP_USER?: string;
    }
  }
}

export const getEmailConfig = () => {
  return createEnv({
    server: {
      EMAIL_SERVICE_PROVIDER: z.enum(['nodemailer', 'resend']).optional(),
      RESEND_API_KEY: z.string().optional(),
      RESEND_FROM: z.string().optional(),
      SMTP_FROM: z.string().optional(),
      SMTP_HOST: z.string().optional(),
      SMTP_PORT: z.coerce.number().optional(),
      SMTP_SECURE: z.boolean().optional(),
      SMTP_USER: z.string().optional(),
      SMTP_PASS: z.string().optional(),
    },
    runtimeEnv: {
      SMTP_FROM: process.env.SMTP_FROM,
      SMTP_HOST: process.env.SMTP_HOST,
      SMTP_PORT: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined,
      SMTP_SECURE: process.env.SMTP_SECURE === 'true',
      SMTP_USER: process.env.SMTP_USER,
      SMTP_PASS: process.env.SMTP_PASS,
      EMAIL_SERVICE_PROVIDER: process.env.EMAIL_SERVICE_PROVIDER
        ? process.env.EMAIL_SERVICE_PROVIDER.toLowerCase()
        : undefined,
      RESEND_API_KEY: process.env.RESEND_API_KEY,
      RESEND_FROM: process.env.RESEND_FROM,
    },
  });
};

export const emailEnv = getEmailConfig();
