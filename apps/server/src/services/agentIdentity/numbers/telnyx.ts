import { createPublicKey, verify } from 'node:crypto';

import type { MessagingCampaignStatus } from '@lobechat/types';

import type { AvailableNumber, InboundSms, NumberProvider, NumberRef, SentSms } from './types';
import { countSmsSegments } from './types';

export interface TelnyxNumberProviderConfig {
  apiBaseUrl?: string;
  /** Telnyx v2 API key (`KEY…`). */
  apiKey: string;
  fetch?: typeof fetch;
  /**
   * Messaging profile the numbers join. Telnyx delivers inbound SMS to the
   * profile's webhook URL rather than per number, so configuring a number
   * means attaching it to this profile and pointing the profile at us.
   */
  messagingProfileId: string;
  now?: () => number;
  /** Account public key (base64, raw Ed25519) that signs webhooks. */
  publicKey: string;
}

const DEFAULT_API_BASE = 'https://api.telnyx.com/v2';

/** Telnyx signs `timestamp|body`; reject deliveries older than this. */
const SIGNATURE_TOLERANCE_SECONDS = 300;

/** DER prefix that wraps a raw 32-byte Ed25519 key into SPKI. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

const toNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.abs(parsed) : undefined;
};

const mapAssignmentStatus = (status: unknown): MessagingCampaignStatus => {
  switch (String(status ?? '').toUpperCase()) {
    case 'ASSIGNED': {
      return 'approved';
    }
    case 'FAILED_ASSIGNMENT':
    case 'FAILED': {
      return 'rejected';
    }
    default: {
      return 'pending';
    }
  }
};

export class TelnyxApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'TelnyxApiError';
    this.status = status;
  }
}

/**
 * Telnyx adapter — same contract as Twilio, so the number service never learns
 * which carrier it is talking to. Ownership is carried in the number's `tags`
 * and `customer_reference`.
 */
export const createTelnyxNumberProvider = (config: TelnyxNumberProviderConfig): NumberProvider => {
  const doFetch = config.fetch ?? fetch;
  const apiBase = (config.apiBaseUrl ?? DEFAULT_API_BASE).replace(/\/$/, '');
  const publicKey = createPublicKey({
    format: 'der',
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(config.publicKey, 'base64')]),
    type: 'spki',
  });

  /** A malformed signature header is a forgery, not a server error. */
  const verifySignature = (payload: string, signature: string): boolean => {
    try {
      return verify(null, Buffer.from(payload), publicKey, Buffer.from(signature, 'base64'));
    } catch {
      return false;
    }
  };

  const request = async <T>(
    method: 'DELETE' | 'GET' | 'PATCH' | 'POST',
    path: string,
    json?: unknown,
  ): Promise<T> => {
    const response = await doFetch(`${apiBase}${path}`, {
      body: json === undefined ? undefined : JSON.stringify(json),
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
        ...(json === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      method,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new TelnyxApiError(
        response.status,
        `Telnyx ${method} ${path.split('?')[0]} failed (${response.status}): ${text}`,
      );
    }

    return (text ? JSON.parse(text) : {}) as T;
  };

  /** The order response names order lines, not number resources; look the number up. */
  const findNumberId = async (phoneNumber: string): Promise<string | undefined> => {
    const { data } = await request<{ data?: { id: string }[] }>(
      'GET',
      `/phone_numbers?filter[phone_number]=${encodeURIComponent(phoneNumber)}`,
    );
    return data?.[0]?.id;
  };

  const configure = async (ref: NumberRef, tag: string, smsWebhookUrl: string) => {
    await request('PATCH', `/messaging_profiles/${config.messagingProfileId}`, {
      webhook_url: smsWebhookUrl,
    });
    await request('PATCH', `/phone_numbers/${ref.providerNumberId}/messaging`, {
      messaging_profile_id: config.messagingProfileId,
    });
    await request('PATCH', `/phone_numbers/${ref.providerNumberId}`, {
      customer_reference: tag,
      tags: [tag],
    });
  };

  return {
    name: 'telnyx',

    search: async (query) => {
      const params = new URLSearchParams({
        'filter[country_code]': query.country ?? 'US',
        'filter[features][]': 'sms',
        'filter[limit]': String(query.limit ?? 5),
      });
      if (query.areaCode) params.set('filter[national_destination_code]', query.areaCode);

      const { data } = await request<{
        data?: {
          cost_information?: { monthly_cost?: string };
          features?: { name: string }[];
          phone_number: string;
          region_information?: { region_name?: string; region_type?: string }[];
        }[];
      }>('GET', `/available_phone_numbers?${params}`);

      return (data ?? []).map((number): AvailableNumber => {
        const features = new Set((number.features ?? []).map((feature) => feature.name));
        const region = number.region_information?.find((item) => item.region_type === 'state');
        const locality = number.region_information?.find(
          (item) => item.region_type === 'rate_center',
        );
        return {
          capabilities: {
            mms: features.has('mms'),
            sms: features.has('sms'),
            voice: features.has('voice'),
          },
          locality: locality?.region_name,
          monthlyCostUsd: toNumber(number.cost_information?.monthly_cost),
          phoneNumber: number.phone_number,
          region: region?.region_name,
        };
      });
    },

    buy: async (phoneNumber, options) => {
      const { data } = await request<{
        data?: { id: string; phone_numbers?: { id: string; phone_number: string }[] };
      }>('POST', '/number_orders', {
        customer_reference: options.tag,
        messaging_profile_id: config.messagingProfileId,
        phone_numbers: [{ phone_number: phoneNumber }],
      });

      const line = data?.phone_numbers?.[0];
      const providerNumberId = (await findNumberId(phoneNumber)) ?? line?.id;
      if (!providerNumberId) {
        throw new Error(`Telnyx number order ${data?.id ?? '?'} did not return ${phoneNumber}`);
      }

      const ref = { phoneNumber, providerNumberId };
      await configure(ref, options.tag, options.smsWebhookUrl);
      return ref;
    },

    configureWebhook: (ref, options) => configure(ref, options.tag, options.smsWebhookUrl),

    messagingEligibility: async (ref) => {
      try {
        const data = await request<{ assignmentStatus?: string; campaignId?: string }>(
          'GET',
          `/10dlc/phone_number_campaigns/${encodeURIComponent(ref.phoneNumber)}`,
        );
        if (!data.campaignId) return { status: 'none' };
        return { campaignId: data.campaignId, status: mapAssignmentStatus(data.assignmentStatus) };
      } catch (error) {
        if (error instanceof TelnyxApiError && error.status === 404) return { status: 'none' };
        throw error;
      }
    },

    send: async (from, message): Promise<SentSms> => {
      const { data } = await request<{
        data?: { cost?: { amount?: string } | null; id: string; parts?: number };
      }>('POST', '/messages', {
        from: from.phoneNumber,
        messaging_profile_id: config.messagingProfileId,
        text: message.text,
        to: message.to,
      });

      return {
        priceUsd: toNumber(data?.cost?.amount),
        providerMessageId: data?.id ?? '',
        segments: data?.parts ?? countSmsSegments(message.text),
      };
    },

    release: async (ref) => {
      try {
        await request('DELETE', `/phone_numbers/${ref.providerNumberId}`);
      } catch (error) {
        if (error instanceof TelnyxApiError && error.status === 404) return;
        throw error;
      }
    },

    peekRecipient: (body) => {
      try {
        const event = JSON.parse(body) as {
          data?: { payload?: { to?: { phone_number?: string }[] } };
        };
        return event.data?.payload?.to?.[0]?.phone_number;
      } catch {
        return undefined;
      }
    },

    parseInbound: async (inbound) => {
      const signature = inbound.headers['telnyx-signature-ed25519'];
      const timestamp = inbound.headers['telnyx-timestamp'];
      if (!signature || !timestamp) return { ok: false };

      const nowSeconds = Math.floor((config.now?.() ?? Date.now()) / 1000);
      if (Math.abs(nowSeconds - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) {
        return { ok: false };
      }

      const valid = verifySignature(`${timestamp}|${inbound.body}`, signature);
      if (!valid) return { ok: false };

      let event: {
        data?: {
          event_type?: string;
          payload?: {
            direction?: string;
            from?: { phone_number?: string };
            id?: string;
            media?: { content_type?: string; url?: string }[];
            parts?: number;
            received_at?: string;
            text?: string;
            to?: { phone_number?: string }[];
          };
        };
      };
      try {
        event = JSON.parse(inbound.body);
      } catch {
        return { ok: false };
      }

      const payload = event.data?.payload;
      // Telnyx posts delivery receipts to the same URL; only inbound messages count.
      if (event.data?.event_type !== 'message.received' || payload?.direction === 'outbound') {
        return { message: null, ok: true };
      }

      const to = payload?.to?.[0]?.phone_number;
      const from = payload?.from?.phone_number;
      if (!payload?.id || !to || !from) return { message: null, ok: true };

      const text = (payload.text ?? '').trim();
      const media = (payload.media ?? [])
        .filter((item) => item.url)
        .map((item) => ({
          mimeType: item.content_type ?? 'application/octet-stream',
          url: item.url!,
        }));
      if (!text && media.length === 0) return { message: null, ok: true };

      const message: InboundSms = {
        from,
        media,
        providerMessageId: payload.id,
        receivedAt: payload.received_at ? new Date(payload.received_at) : new Date(),
        segments: payload.parts ?? countSmsSegments(text),
        text,
        to,
      };
      return { message, ok: true };
    },
  };
};
