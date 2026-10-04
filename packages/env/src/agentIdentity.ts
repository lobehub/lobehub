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
    }
  }
}

/**
 * Server config for the agent identity providers.
 *
 * Agent Mail (lobe.id) is the only identity provider today, so
 * `ENABLED_AGENT_IDENTITY` currently mirrors `ENABLED_AGENT_MAIL`; it stays a
 * separate flag for callers that only need to know whether *any* provider is
 * usable. iMessage / SMS is not an agent identity: it is served by the
 * messenger `linq` platform from a shared number pool.
 */
export const getAgentIdentityConfig = () =>
  createEnv({
    runtimeEnv: {
      AGENT_MAIL_API_BASE_URL: process.env.AGENT_MAIL_API_BASE_URL,
      AGENT_MAIL_API_KEY: process.env.AGENT_MAIL_API_KEY,
      AGENT_MAIL_WEBHOOK_SECRET: process.env.AGENT_MAIL_WEBHOOK_SECRET,
      AGENT_MAIL_WEBHOOK_URL: process.env.AGENT_MAIL_WEBHOOK_URL,
      ENABLED_AGENT_IDENTITY: !!process.env.AGENT_MAIL_API_KEY,
      ENABLED_AGENT_MAIL: !!process.env.AGENT_MAIL_API_KEY,
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
    },
  });

export const agentIdentityEnv = getAgentIdentityConfig();
