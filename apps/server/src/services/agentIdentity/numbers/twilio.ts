import { createHmac, timingSafeEqual } from 'node:crypto';

import type { MessagingCampaignStatus } from '@lobechat/types';

import type {
  AvailableNumber,
  InboundSms,
  NumberMessagingEligibility,
  NumberProvider,
  NumberRef,
  SentSms,
  VoiceCallMode,
} from './types';
import { countSmsSegments } from './types';

export interface TwilioNumberProviderConfig {
  /** `AC…`. Test credentials work for buy/send against Twilio's magic numbers. */
  accountSid: string;
  /** REST base override (a sandbox in acceptance). Defaults to `https://api.twilio.com`. */
  apiBaseUrl?: string;
  authToken: string;
  fetch?: typeof fetch;
  /** Messaging API base override. Defaults to `https://messaging.twilio.com`. */
  messagingApiBaseUrl?: string;
  /**
   * `MG…` — the Messaging Service registered to the operator's A2P 10DLC
   * campaign. When set, assigned numbers are attached to it and eligibility is
   * read from its campaign; when unset, every number stays receive-only.
   */
  messagingServiceSid?: string;
  /**
   * The exact URL Twilio posts inbound SMS to. Twilio signs over the URL it
   * called, so verification uses this configured value rather than whatever
   * host header a proxy forwarded.
   */
  smsWebhookUrl: string;
  /**
   * The URL Twilio posts inbound calls to. Defaults to `<smsWebhookUrl>/voice`.
   * Voicemail transcriptions are posted back to `smsWebhookUrl`, so they enter
   * the same inbox pipeline as a text message.
   */
  voiceWebhookUrl?: string;
}

const DEFAULT_API_BASE = 'https://api.twilio.com';
const DEFAULT_MESSAGING_BASE = 'https://messaging.twilio.com';

/** Twilio error 21710: the number is already in this Messaging Service. */
const ALREADY_IN_SERVICE = 21_710;

const toNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.abs(parsed) : undefined;
};

/**
 * `X-Twilio-Signature`: base64 HMAC-SHA1 over the full URL followed by every
 * POST parameter as `key + value`, keys sorted. Exported for the sandbox and
 * tests, which must sign exactly like Twilio does.
 */
export const computeTwilioSignature = (
  authToken: string,
  url: string,
  params: Record<string, string>,
): string => {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
};

const safeEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

/** Twilio's US A2P compliance states, folded onto ours. */
const mapCampaignStatus = (status: unknown): MessagingCampaignStatus => {
  switch (String(status ?? '').toUpperCase()) {
    case 'VERIFIED': {
      return 'approved';
    }
    case 'FAILED': {
      return 'rejected';
    }
    case '': {
      return 'none';
    }
    default: {
      return 'pending';
    }
  }
};

/**
 * A read-out code is transcribed digit by digit ("9 1 4 2 7 7"); join such runs
 * (4–8 digits) so the inbox can extract it like a texted code.
 */
export const collapseSpokenDigits = (text: string): string =>
  text.replaceAll(/\b\d(?:[ ,-]\d){3,7}\b/g, (run) => run.replaceAll(/[ ,-]/g, ''));

const escapeXml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/**
 * TwiML for an inbound call. A live number records a voicemail and has Twilio
 * transcribe it back to the SMS webhook; a quarantined number says it is out
 * of service — the call equivalent of the SMS auto-reply — and records nothing.
 */
export const twilioVoiceTwiml = (mode: VoiceCallMode, transcriptionCallbackUrl: string): string => {
  const xml = '<?xml version="1.0" encoding="UTF-8"?>';
  switch (mode) {
    case 'voicemail': {
      return (
        `${xml}<Response><Say>Please leave a message after the tone.</Say>` +
        `<Record maxLength="120" playBeep="true" transcribe="true" transcribeCallback="${escapeXml(transcriptionCallbackUrl)}"/>` +
        '</Response>'
      );
    }
    case 'out-of-service': {
      return `${xml}<Response><Say>This number is no longer in service.</Say><Hangup/></Response>`;
    }
    default: {
      return `${xml}<Response><Reject/></Response>`;
    }
  }
};

export class TwilioApiError extends Error {
  readonly code?: number;
  readonly status: number;

  constructor(status: number, code: number | undefined, message: string) {
    super(message);
    this.name = 'TwilioApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Twilio adapter. One operator account (MVP); each number carries its owner in
 * `FriendlyName` (`agent:<id>`) so the carrier console answers "whose number is
 * this" without our database.
 */
export const createTwilioNumberProvider = (config: TwilioNumberProviderConfig): NumberProvider => {
  const doFetch = config.fetch ?? fetch;
  const apiBase = (config.apiBaseUrl ?? DEFAULT_API_BASE).replace(/\/$/, '');
  const messagingBase = (config.messagingApiBaseUrl ?? DEFAULT_MESSAGING_BASE).replace(/\/$/, '');
  const accountBase = `${apiBase}/2010-04-01/Accounts/${config.accountSid}`;
  const authorization = `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64')}`;

  const request = async <T>(
    method: 'DELETE' | 'GET' | 'POST',
    url: string,
    form?: Record<string, string | undefined>,
  ): Promise<{ data: T; status: number }> => {
    const body = form
      ? new URLSearchParams(
          Object.entries(form).filter((entry): entry is [string, string] => entry[1] !== undefined),
        ).toString()
      : undefined;

    const response = await doFetch(url, {
      body,
      headers: {
        Accept: 'application/json',
        Authorization: authorization,
        ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      method,
    });

    const text = await response.text();
    const data = (text ? JSON.parse(text) : {}) as T & { code?: number; message?: string };

    if (!response.ok) {
      throw new TwilioApiError(
        response.status,
        data.code,
        `Twilio ${method} ${new URL(url).pathname} failed (${response.status}${data.code ? ` / ${data.code}` : ''}): ${data.message ?? text}`,
      );
    }

    return { data, status: response.status };
  };

  const voiceUrl = (smsWebhookUrl: string) =>
    config.voiceWebhookUrl ?? `${smsWebhookUrl.replace(/\/$/, '')}/voice`;

  /** Verify `X-Twilio-Signature` over the URL Twilio called; the params when authentic. */
  const verified = (
    inbound: { body: string; headers: Record<string, string | undefined> },
    url: string,
  ): Record<string, string> | undefined => {
    const signature = inbound.headers['x-twilio-signature'];
    if (!signature) return undefined;

    const params = Object.fromEntries(new URLSearchParams(inbound.body));
    if (!safeEqual(signature, computeTwilioSignature(config.authToken, url, params)))
      return undefined;
    // Only the account the number belongs to may deliver for it.
    if (params.AccountSid && params.AccountSid !== config.accountSid) return undefined;
    return params;
  };

  const numberUrl = (ref: NumberRef) =>
    `${accountBase}/IncomingPhoneNumbers/${encodeURIComponent(ref.providerNumberId)}.json`;

  /** Attach to the 10DLC Messaging Service; "already attached" is success. */
  const attachToMessagingService = async (ref: NumberRef) => {
    if (!config.messagingServiceSid) return;
    try {
      await request(
        'POST',
        `${messagingBase}/v1/Services/${config.messagingServiceSid}/PhoneNumbers`,
        { PhoneNumberSid: ref.providerNumberId },
      );
    } catch (error) {
      if (error instanceof TwilioApiError && error.code === ALREADY_IN_SERVICE) return;
      throw error;
    }
  };

  return {
    name: 'twilio',

    search: async (query) => {
      const params = new URLSearchParams({
        PageSize: String(query.limit ?? 5),
        SmsEnabled: 'true',
      });
      if (query.areaCode) params.set('AreaCode', query.areaCode);

      const { data } = await request<{
        available_phone_numbers?: {
          capabilities?: {
            MMS?: boolean;
            SMS?: boolean;
            mms?: boolean;
            sms?: boolean;
            voice?: boolean;
          };
          locality?: string;
          phone_number: string;
          region?: string;
        }[];
      }>(
        'GET',
        `${accountBase}/AvailablePhoneNumbers/${query.country ?? 'US'}/Local.json?${params}`,
      );

      return (data.available_phone_numbers ?? []).map((number): AvailableNumber => ({
        capabilities: {
          mms: !!(number.capabilities?.MMS ?? number.capabilities?.mms),
          sms: !!(number.capabilities?.SMS ?? number.capabilities?.sms),
          voice: !!number.capabilities?.voice,
        },
        locality: number.locality,
        phoneNumber: number.phone_number,
        region: number.region,
      }));
    },

    buy: async (phoneNumber, options) => {
      const { data } = await request<{ phone_number: string; sid: string }>(
        'POST',
        `${accountBase}/IncomingPhoneNumbers.json`,
        {
          FriendlyName: options.tag,
          PhoneNumber: phoneNumber,
          SmsMethod: 'POST',
          SmsUrl: options.smsWebhookUrl,
          VoiceMethod: 'POST',
          VoiceUrl: voiceUrl(options.smsWebhookUrl),
        },
      );

      return { phoneNumber: data.phone_number ?? phoneNumber, providerNumberId: data.sid };
    },

    configureWebhook: async (ref, options) => {
      await request('POST', numberUrl(ref), {
        FriendlyName: options.tag,
        SmsMethod: 'POST',
        SmsUrl: options.smsWebhookUrl,
        VoiceMethod: 'POST',
        VoiceUrl: voiceUrl(options.smsWebhookUrl),
      });
      await attachToMessagingService(ref);
    },

    messagingEligibility: async (ref): Promise<NumberMessagingEligibility> => {
      if (!config.messagingServiceSid) return { status: 'none' };

      // Not in the service = not on the campaign, whatever the campaign's state.
      try {
        await request(
          'GET',
          `${messagingBase}/v1/Services/${config.messagingServiceSid}/PhoneNumbers/${ref.providerNumberId}`,
        );
      } catch (error) {
        if (error instanceof TwilioApiError && error.status === 404) return { status: 'none' };
        throw error;
      }

      const { data } = await request<{
        compliance?: { campaign_status?: string; sid?: string }[];
      }>('GET', `${messagingBase}/v1/Services/${config.messagingServiceSid}/Compliance/Usa2p`);

      const campaign = data.compliance?.[0];
      if (!campaign) return { status: 'none' };

      return { campaignId: campaign.sid, status: mapCampaignStatus(campaign.campaign_status) };
    },

    send: async (from, message): Promise<SentSms> => {
      const { data } = await request<{
        num_segments?: string;
        price?: string | null;
        sid: string;
      }>('POST', `${accountBase}/Messages.json`, {
        Body: message.text,
        From: from.phoneNumber,
        To: message.to,
      });

      return {
        priceUsd: toNumber(data.price),
        providerMessageId: data.sid,
        segments: toNumber(data.num_segments) ?? countSmsSegments(message.text),
      };
    },

    release: async (ref) => {
      try {
        await request('DELETE', numberUrl(ref));
      } catch (error) {
        // Already gone at the carrier: the release we wanted has happened.
        if (error instanceof TwilioApiError && error.status === 404) return;
        throw error;
      }
    },

    peekRecipient: (body) => new URLSearchParams(body).get('To') ?? undefined,

    answerVoiceCall: async (inbound, resolve) => {
      const params = verified(inbound, voiceUrl(config.smsWebhookUrl));
      if (!params) {
        return { body: 'Forbidden', contentType: 'text/plain', mode: 'rejected', status: 401 };
      }

      const mode = params.To ? await resolve(params.To) : 'unknown';
      return {
        body: twilioVoiceTwiml(mode, config.smsWebhookUrl),
        contentType: 'text/xml',
        mode,
        status: 200,
      };
    },

    parseInbound: async (inbound) => {
      const params = verified(inbound, config.smsWebhookUrl);
      if (!params) return { ok: false };

      // A voicemail transcription (the callback our <Record> asked for): the
      // caller's words become an inbox message like any text, minus SMS billing.
      if (params.TranscriptionSid) {
        const transcript = (params.TranscriptionText ?? '').trim();
        if (
          params.TranscriptionStatus !== 'completed' ||
          !transcript ||
          !params.To ||
          !params.From
        ) {
          return { message: null, ok: true };
        }
        return {
          message: {
            from: params.From,
            media: params.RecordingUrl ? [{ mimeType: 'audio/wav', url: params.RecordingUrl }] : [],
            providerMessageId: params.TranscriptionSid,
            receivedAt: new Date(),
            segments: 0,
            text: `Voicemail: ${collapseSpokenDigits(transcript)}`,
            to: params.To,
          },
          ok: true,
        };
      }

      const sid = params.MessageSid ?? params.SmsSid;
      if (!sid || !params.To || !params.From) return { message: null, ok: true };

      const mediaCount = Number(params.NumMedia ?? 0) || 0;
      const media = Array.from({ length: mediaCount }, (_, i) => ({
        mimeType: params[`MediaContentType${i}`] ?? 'application/octet-stream',
        url: params[`MediaUrl${i}`] ?? '',
      })).filter((item) => item.url);

      const text = (params.Body ?? '').trim();
      if (!text && media.length === 0) return { message: null, ok: true };

      const message: InboundSms = {
        from: params.From,
        media,
        providerMessageId: sid,
        receivedAt: new Date(),
        segments: toNumber(params.NumSegments) ?? countSmsSegments(text),
        text,
        to: params.To,
      };

      return { message, ok: true };
    },
  };
};
