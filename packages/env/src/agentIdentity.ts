import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    interface ProcessEnv {
      /** Override for the Agent Mail REST base. Defaults to `https://api.lobe.id`. */
      AGENT_MAIL_API_BASE_URL?: string;
      /** Agent Mail (lobe.id) API key (`am_…`), the tenant that owns agent inboxes. */
      AGENT_MAIL_API_KEY?: string;
      /** Shared Agent Mail webhook secret, used when an account has no own one. */
      AGENT_MAIL_WEBHOOK_SECRET?: string;
      /**
       * Public HTTPS endpoint Agent Mail signs deliveries against. When set,
       * provisioning registers it and stores the returned per-inbox secret as
       * the account credential.
       */
      AGENT_MAIL_WEBHOOK_URL?: string;

      /** Carrier fee per SMS segment passed through to the agent, in USD. */
      AGENT_NUMBER_CARRIER_FEE_USD?: string;
      /** ISO country dedicated numbers are bought in. Defaults to `US`. */
      AGENT_NUMBER_COUNTRY?: string;
      /** Outbound SMS segments one agent may send per day. */
      AGENT_NUMBER_DAILY_SEGMENT_LIMIT?: string;
      /** Number fee billed to the agent per month, in USD. */
      AGENT_NUMBER_MONTHLY_FEE_USD?: string;
      /** Everything one agent's number may cost per calendar month, in USD. */
      AGENT_NUMBER_MONTHLY_SPEND_LIMIT_USD?: string;
      /** Area codes the warm pool keeps numbers in, comma-separated (`415,212`). */
      AGENT_NUMBER_POOL_AREA_CODES?: string;
      /** Warm-pool size per area code. */
      AGENT_NUMBER_POOL_SIZE?: string;
      /** Days a given-up number answers "out of service" before release (30–60). */
      AGENT_NUMBER_QUARANTINE_DAYS?: string;
      /** Per-segment SMS price passed through to the agent, in USD. */
      AGENT_NUMBER_SMS_SEGMENT_USD?: string;
      /**
       * Public origin carriers post inbound SMS to, e.g. `https://app.lobehub.com`.
       * The webhook path is appended per provider.
       */
      AGENT_NUMBER_WEBHOOK_BASE_URL?: string;

      TELNYX_API_BASE_URL?: string;
      /** Telnyx v2 API key. Enables Telnyx dedicated numbers. */
      TELNYX_API_KEY?: string;
      /** Messaging profile numbers join; its webhook URL is pointed at us. */
      TELNYX_MESSAGING_PROFILE_ID?: string;
      /** Account public key (base64 Ed25519) that signs Telnyx webhooks. */
      TELNYX_PUBLIC_KEY?: string;

      /** `AC…`. With TWILIO_AUTH_TOKEN, enables Twilio dedicated numbers. */
      TWILIO_ACCOUNT_SID?: string;
      /** REST base override (sandbox). Defaults to `https://api.twilio.com`. */
      TWILIO_API_BASE_URL?: string;
      TWILIO_AUTH_TOKEN?: string;
      /** Messaging API base override. Defaults to `https://messaging.twilio.com`. */
      TWILIO_MESSAGING_API_BASE_URL?: string;
      /** `MG…` Messaging Service on the operator's approved 10DLC campaign. */
      TWILIO_MESSAGING_SERVICE_SID?: string;
    }
  }
}

/**
 * Server config for the agent identity providers.
 *
 * Every provider is an independent capability: a deployment that has wired up
 * Agent Mail but no carrier gets a registry with mail only, and vice versa.
 * `ENABLED_AGENT_IDENTITY` is the union, for callers that only need to know
 * whether *any* provider is usable.
 *
 * Phone numbers are dedicated, paid, one per agent, bought from a carrier API
 * (Twilio first, Telnyx as the second adapter). The shared Linq pool is the
 * free user-binding channel and lives in the messenger, not here.
 */
export const getAgentIdentityConfig = () => {
  const twilio = !!process.env.TWILIO_ACCOUNT_SID && !!process.env.TWILIO_AUTH_TOKEN;
  const telnyx =
    !!process.env.TELNYX_API_KEY &&
    !!process.env.TELNYX_PUBLIC_KEY &&
    !!process.env.TELNYX_MESSAGING_PROFILE_ID;
  // A carrier without a public webhook origin could sell a number nobody can text.
  const numbers = !!process.env.AGENT_NUMBER_WEBHOOK_BASE_URL;

  return createEnv({
    runtimeEnv: {
      AGENT_MAIL_API_BASE_URL: process.env.AGENT_MAIL_API_BASE_URL,
      AGENT_MAIL_API_KEY: process.env.AGENT_MAIL_API_KEY,
      AGENT_MAIL_WEBHOOK_SECRET: process.env.AGENT_MAIL_WEBHOOK_SECRET,
      AGENT_MAIL_WEBHOOK_URL: process.env.AGENT_MAIL_WEBHOOK_URL,
      AGENT_NUMBER_CARRIER_FEE_USD: process.env.AGENT_NUMBER_CARRIER_FEE_USD || undefined,
      AGENT_NUMBER_COUNTRY: process.env.AGENT_NUMBER_COUNTRY || undefined,
      AGENT_NUMBER_DAILY_SEGMENT_LIMIT: process.env.AGENT_NUMBER_DAILY_SEGMENT_LIMIT || undefined,
      AGENT_NUMBER_MONTHLY_FEE_USD: process.env.AGENT_NUMBER_MONTHLY_FEE_USD || undefined,
      AGENT_NUMBER_MONTHLY_SPEND_LIMIT_USD:
        process.env.AGENT_NUMBER_MONTHLY_SPEND_LIMIT_USD || undefined,
      AGENT_NUMBER_POOL_AREA_CODES: process.env.AGENT_NUMBER_POOL_AREA_CODES || undefined,
      AGENT_NUMBER_POOL_SIZE: process.env.AGENT_NUMBER_POOL_SIZE || undefined,
      AGENT_NUMBER_QUARANTINE_DAYS: process.env.AGENT_NUMBER_QUARANTINE_DAYS || undefined,
      AGENT_NUMBER_SMS_SEGMENT_USD: process.env.AGENT_NUMBER_SMS_SEGMENT_USD || undefined,
      AGENT_NUMBER_WEBHOOK_BASE_URL: process.env.AGENT_NUMBER_WEBHOOK_BASE_URL || undefined,
      ENABLED_AGENT_IDENTITY: !!process.env.AGENT_MAIL_API_KEY || (numbers && (twilio || telnyx)),
      ENABLED_AGENT_MAIL: !!process.env.AGENT_MAIL_API_KEY,
      ENABLED_TELNYX: numbers && telnyx,
      ENABLED_TWILIO: numbers && twilio,
      TELNYX_API_BASE_URL: process.env.TELNYX_API_BASE_URL,
      TELNYX_API_KEY: process.env.TELNYX_API_KEY,
      TELNYX_MESSAGING_PROFILE_ID: process.env.TELNYX_MESSAGING_PROFILE_ID,
      TELNYX_PUBLIC_KEY: process.env.TELNYX_PUBLIC_KEY,
      TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
      TWILIO_API_BASE_URL: process.env.TWILIO_API_BASE_URL,
      TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
      TWILIO_MESSAGING_API_BASE_URL: process.env.TWILIO_MESSAGING_API_BASE_URL,
      TWILIO_MESSAGING_SERVICE_SID: process.env.TWILIO_MESSAGING_SERVICE_SID,
    },
    server: {
      AGENT_MAIL_API_BASE_URL: z.string().optional(),
      AGENT_MAIL_API_KEY: z.string().optional(),
      AGENT_MAIL_WEBHOOK_SECRET: z.string().optional(),
      AGENT_MAIL_WEBHOOK_URL: z.string().optional(),
      AGENT_NUMBER_CARRIER_FEE_USD: z.coerce.number().min(0).default(0.003),
      AGENT_NUMBER_COUNTRY: z.string().default('US'),
      AGENT_NUMBER_DAILY_SEGMENT_LIMIT: z.coerce.number().int().min(0).default(200),
      AGENT_NUMBER_MONTHLY_FEE_USD: z.coerce.number().min(0).default(1.15),
      AGENT_NUMBER_MONTHLY_SPEND_LIMIT_USD: z.coerce.number().min(0).default(20),
      AGENT_NUMBER_POOL_AREA_CODES: z.string().optional(),
      AGENT_NUMBER_POOL_SIZE: z.coerce.number().int().min(0).default(2),
      /** Clamped to the 30–60 day window the release policy allows. */
      AGENT_NUMBER_QUARANTINE_DAYS: z.coerce
        .number()
        .int()
        .default(45)
        .transform((days) => Math.min(60, Math.max(30, days))),
      AGENT_NUMBER_SMS_SEGMENT_USD: z.coerce.number().min(0).default(0.0083),
      AGENT_NUMBER_WEBHOOK_BASE_URL: z.string().optional(),
      /** True when at least one identity provider is configured. */
      ENABLED_AGENT_IDENTITY: z.boolean(),
      /** True when the Agent Mail (`am_…`) key is present. */
      ENABLED_AGENT_MAIL: z.boolean(),
      ENABLED_TELNYX: z.boolean(),
      ENABLED_TWILIO: z.boolean(),
      TELNYX_API_BASE_URL: z.string().optional(),
      TELNYX_API_KEY: z.string().optional(),
      TELNYX_MESSAGING_PROFILE_ID: z.string().optional(),
      TELNYX_PUBLIC_KEY: z.string().optional(),
      TWILIO_ACCOUNT_SID: z.string().optional(),
      TWILIO_API_BASE_URL: z.string().optional(),
      TWILIO_AUTH_TOKEN: z.string().optional(),
      TWILIO_MESSAGING_API_BASE_URL: z.string().optional(),
      TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),
    },
  });
};

export const agentIdentityEnv = getAgentIdentityConfig();
