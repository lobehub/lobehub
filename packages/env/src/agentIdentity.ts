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
      /** Override for the Linq REST base. Defaults to `https://api.linqapp.com/v3`. */
      LINQ_API_BASE_URL?: string;
      /** Linq partner API key. */
      LINQ_API_KEY?: string;
      /**
       * The operator's Linq number pool in E.164, comma-separated. Linq numbers
       * are carrier inventory, not something an API call mints, so a deployment
       * configures the numbers agent accounts bind to — one live account each.
       */
      LINQ_FROM_NUMBER?: string;
      /** Shared Linq webhook signing secret (`whsec_…`). */
      LINQ_WEBHOOK_SECRET?: string;
    }
  }
}

/**
 * Server config for the agent identity providers.
 *
 * Both providers are independent capabilities: a deployment that has wired up
 * Agent Mail but not Linq gets a registry with one provider, and vice versa.
 * `ENABLED_AGENT_IDENTITY` is the union, for callers that only need to know
 * whether *any* provider is usable.
 */
export const getAgentIdentityConfig = () =>
  createEnv({
    runtimeEnv: {
      AGENT_MAIL_API_BASE_URL: process.env.AGENT_MAIL_API_BASE_URL,
      AGENT_MAIL_API_KEY: process.env.AGENT_MAIL_API_KEY,
      AGENT_MAIL_WEBHOOK_SECRET: process.env.AGENT_MAIL_WEBHOOK_SECRET,
      AGENT_MAIL_WEBHOOK_URL: process.env.AGENT_MAIL_WEBHOOK_URL,
      ENABLED_AGENT_IDENTITY: !!process.env.AGENT_MAIL_API_KEY || !!process.env.LINQ_API_KEY,
      ENABLED_AGENT_MAIL: !!process.env.AGENT_MAIL_API_KEY,
      ENABLED_LINQ: !!process.env.LINQ_API_KEY,
      LINQ_API_BASE_URL: process.env.LINQ_API_BASE_URL,
      LINQ_API_KEY: process.env.LINQ_API_KEY,
      LINQ_FROM_NUMBER: process.env.LINQ_FROM_NUMBER,
      LINQ_WEBHOOK_SECRET: process.env.LINQ_WEBHOOK_SECRET,
    },
    server: {
      AGENT_MAIL_API_BASE_URL: z.string().optional(),
      AGENT_MAIL_API_KEY: z.string().optional(),
      AGENT_MAIL_WEBHOOK_SECRET: z.string().optional(),
      AGENT_MAIL_WEBHOOK_URL: z.string().optional(),
      /** True when at least one identity provider is configured. */
      ENABLED_AGENT_IDENTITY: z.boolean(),
      /** True when the Agent Mail (`am_…`) key is present. */
      ENABLED_AGENT_MAIL: z.boolean(),
      /** True when the Linq key is present. */
      ENABLED_LINQ: z.boolean(),
      LINQ_API_BASE_URL: z.string().optional(),
      LINQ_API_KEY: z.string().optional(),
      LINQ_FROM_NUMBER: z.string().optional(),
      LINQ_WEBHOOK_SECRET: z.string().optional(),
    },
  });

export const agentIdentityEnv = getAgentIdentityConfig();
