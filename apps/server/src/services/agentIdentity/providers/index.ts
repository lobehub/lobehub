import type { AgentNumberProviderName } from '@lobechat/types';

import type { LobeChatDatabase } from '@/database/type';
import { agentIdentityEnv } from '@/envs/agentIdentity';

import { createDedicatedNumberAccountProvider } from '../numbers/accountProvider';
import type { DedicatedNumberSettings } from '../numbers/service';
import { DedicatedNumberService } from '../numbers/service';
import type { TelnyxNumberProviderConfig } from '../numbers/telnyx';
import { createTelnyxNumberProvider } from '../numbers/telnyx';
import type { TwilioNumberProviderConfig } from '../numbers/twilio';
import { createTwilioNumberProvider } from '../numbers/twilio';
import type { NumberProvider } from '../numbers/types';
import { AgentAccountProviderRegistry } from '../registry';
import type { AgentMailProviderConfig } from './agentMail';
import { createAgentMailProvider } from './agentMail';

export type { AgentMailProviderConfig } from './agentMail';
export { createAgentMailProvider } from './agentMail';

/** Where carriers post inbound SMS for a provider. */
export const agentNumberWebhookUrl = (baseUrl: string, provider: AgentNumberProviderName) =>
  `${baseUrl.replace(/\/$/, '')}/api/agent/accounts/webhooks/${provider}`;

/** The pool / pricing / cap settings every carrier shares, from env. */
export const dedicatedNumberSettingsFromEnv = (
  provider: AgentNumberProviderName,
): DedicatedNumberSettings => ({
  country: agentIdentityEnv.AGENT_NUMBER_COUNTRY,
  limits: {
    dailyOutboundSegments: agentIdentityEnv.AGENT_NUMBER_DAILY_SEGMENT_LIMIT,
    monthlySpendUsd: agentIdentityEnv.AGENT_NUMBER_MONTHLY_SPEND_LIMIT_USD,
  },
  poolAreaCodes: (agentIdentityEnv.AGENT_NUMBER_POOL_AREA_CODES ?? '')
    .split(',')
    .map((code) => code.trim())
    .filter(Boolean),
  poolSize: agentIdentityEnv.AGENT_NUMBER_POOL_SIZE,
  pricing: {
    carrierFeeUsd: agentIdentityEnv.AGENT_NUMBER_CARRIER_FEE_USD,
    monthlyFeeUsd: agentIdentityEnv.AGENT_NUMBER_MONTHLY_FEE_USD,
    smsSegmentUsd: agentIdentityEnv.AGENT_NUMBER_SMS_SEGMENT_USD,
  },
  quarantineDays: agentIdentityEnv.AGENT_NUMBER_QUARANTINE_DAYS,
  smsWebhookUrl: agentNumberWebhookUrl(
    agentIdentityEnv.AGENT_NUMBER_WEBHOOK_BASE_URL ?? '',
    provider,
  ),
});

/** One carrier, wired: its adapter and the settings its number service runs with. */
export interface DedicatedNumberCarrierConfig {
  carrier: NumberProvider;
  settings: DedicatedNumberSettings;
}

/** Which providers a deployment has wired up. Omitted = not registered. */
export interface AgentIdentityProviderConfig {
  agentMail?: AgentMailProviderConfig;
  /** Dedicated-number carriers, in preference order (Twilio first). */
  numbers?: DedicatedNumberCarrierConfig[];
}

/**
 * Build a registry from an explicit config. Pure and injectable, so tests and
 * offline acceptance can register providers with fixture keys and a mock fetch
 * instead of reading deployment env.
 */
export const createAgentAccountRegistry = (
  config: AgentIdentityProviderConfig,
  db?: LobeChatDatabase,
): AgentAccountProviderRegistry => {
  const registry = new AgentAccountProviderRegistry();

  if (config.agentMail) registry.register(createAgentMailProvider(config.agentMail));

  for (const { carrier, settings } of config.numbers ?? []) {
    if (!db) {
      throw new Error('Dedicated numbers need a database: pass db to createAgentAccountRegistry.');
    }
    registry.register(
      createDedicatedNumberAccountProvider(new DedicatedNumberService(db, carrier, settings)),
    );
  }

  return registry;
};

const twilioConfigFromEnv = (): TwilioNumberProviderConfig | undefined =>
  agentIdentityEnv.ENABLED_TWILIO
    ? {
        accountSid: agentIdentityEnv.TWILIO_ACCOUNT_SID!,
        apiBaseUrl: agentIdentityEnv.TWILIO_API_BASE_URL,
        authToken: agentIdentityEnv.TWILIO_AUTH_TOKEN!,
        messagingApiBaseUrl: agentIdentityEnv.TWILIO_MESSAGING_API_BASE_URL,
        messagingServiceSid: agentIdentityEnv.TWILIO_MESSAGING_SERVICE_SID,
        smsWebhookUrl: dedicatedNumberSettingsFromEnv('twilio').smsWebhookUrl,
      }
    : undefined;

const telnyxConfigFromEnv = (): TelnyxNumberProviderConfig | undefined =>
  agentIdentityEnv.ENABLED_TELNYX
    ? {
        apiBaseUrl: agentIdentityEnv.TELNYX_API_BASE_URL,
        apiKey: agentIdentityEnv.TELNYX_API_KEY!,
        messagingProfileId: agentIdentityEnv.TELNYX_MESSAGING_PROFILE_ID!,
        publicKey: agentIdentityEnv.TELNYX_PUBLIC_KEY!,
      }
    : undefined;

/** The carriers this deployment has credentials for, Twilio first. */
export const createDefaultNumberCarriers = (): DedicatedNumberCarrierConfig[] => {
  const carriers: DedicatedNumberCarrierConfig[] = [];

  const twilio = twilioConfigFromEnv();
  if (twilio) {
    carriers.push({
      carrier: createTwilioNumberProvider(twilio),
      settings: dedicatedNumberSettingsFromEnv('twilio'),
    });
  }

  const telnyx = telnyxConfigFromEnv();
  if (telnyx) {
    carriers.push({
      carrier: createTelnyxNumberProvider(telnyx),
      settings: dedicatedNumberSettingsFromEnv('telnyx'),
    });
  }

  return carriers;
};

/**
 * The deployment registry: register each provider whose credentials are
 * present. A missing key omits the provider entirely rather than registering a
 * broken one, so `registry.get('twilio')` fails with the real reason.
 */
export const createDefaultAgentAccountRegistry = (
  db: LobeChatDatabase,
): AgentAccountProviderRegistry =>
  createAgentAccountRegistry(
    {
      agentMail:
        agentIdentityEnv.ENABLED_AGENT_MAIL && agentIdentityEnv.AGENT_MAIL_API_KEY
          ? {
              apiBaseUrl: agentIdentityEnv.AGENT_MAIL_API_BASE_URL,
              apiKey: agentIdentityEnv.AGENT_MAIL_API_KEY,
              webhookSecret: agentIdentityEnv.AGENT_MAIL_WEBHOOK_SECRET,
              webhookUrl: agentIdentityEnv.AGENT_MAIL_WEBHOOK_URL,
            }
          : undefined,
      numbers: createDefaultNumberCarriers(),
    },
    db,
  );

/** Number services for scheduled maintenance (pool top-up, release, monthly fees). */
export const createDefaultNumberServices = (db: LobeChatDatabase): DedicatedNumberService[] =>
  createDefaultNumberCarriers().map(
    ({ carrier, settings }) => new DedicatedNumberService(db, carrier, settings),
  );
