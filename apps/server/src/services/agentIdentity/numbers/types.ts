import type { AgentNumberProviderName, MessagingCampaignStatus } from '@lobechat/types';

/**
 * The carrier-facing half of a dedicated agent number: buying, pointing and
 * returning numbers, and moving SMS through them.
 *
 * Deliberately below `AgentAccountProvider`: a carrier knows numbers, not
 * agents. Pool allocation, quarantine, billing and the agent account row are
 * the number service's job; an adapter only translates these calls into one
 * carrier's REST API and webhook format, so adding a carrier is one file.
 */
export interface NumberProvider {
  /**
   * Answer an inbound call, for carriers whose voice webhook is answered
   * synchronously (Twilio TwiML). `resolve` says what the called number is:
   * a live agent number takes a voicemail (transcribed into the inbox like an
   * SMS), a quarantined one says it is out of service. Voice is not subject to
   * 10DLC, so this needs no campaign. Omitted = the carrier's voice is not wired.
   */
  answerVoiceCall?: (
    request: NumberInboundRequest,
    resolve: (to: string) => Promise<VoiceCallMode>,
  ) => Promise<VoiceCallAnswer>;

  /**
   * Buy one specific number found by {@link search} and point its inbound at
   * us. The number is billable from the moment this resolves.
   */
  buy: (phoneNumber: string, options: NumberBuyOptions) => Promise<PurchasedNumber>;

  /**
   * Point an owned number's inbound webhooks at us and (re)tag it. Idempotent;
   * also used to retag a pooled number with its new agent on assignment.
   */
  configureWebhook: (number: NumberRef, options: NumberConfigureOptions) => Promise<void>;

  /**
   * Read the number's US A2P 10DLC standing back from the carrier. Outbound SMS
   * opens only on `approved`; nothing may assume it.
   */
  messagingEligibility: (number: NumberRef) => Promise<NumberMessagingEligibility>;

  readonly name: AgentNumberProviderName;

  /** Verify and parse one inbound SMS webhook. `null` = forged or not a message. */
  parseInbound: (request: NumberInboundRequest) => Promise<NumberInboundParseResult>;

  /**
   * Read the recipient number out of an *unverified* delivery so the right
   * account (and its secret) can be found before verification. Never trusted.
   */
  peekRecipient: (body: string) => string | undefined;

  /** Return the number to the carrier. Terminal — billing stops, the number is gone. */
  release: (number: NumberRef) => Promise<void>;

  /** List numbers the carrier can sell right now. */
  search: (query: NumberSearchQuery) => Promise<AvailableNumber[]>;

  /** Send one SMS from an owned number. */
  send: (from: NumberRef, message: { text: string; to: string }) => Promise<SentSms>;
}

export interface NumberSearchQuery {
  areaCode?: string;
  /** ISO country, `US` by default. */
  country?: string;
  limit?: number;
}

export interface AvailableNumber {
  capabilities: { mms: boolean; sms: boolean; voice: boolean };
  locality?: string;
  /** Carrier list price per month, when the search response carries one. */
  monthlyCostUsd?: number;
  phoneNumber: string;
  region?: string;
}

export interface NumberRef {
  phoneNumber: string;
  providerNumberId: string;
}

export interface NumberConfigureOptions {
  /** Public HTTPS endpoint the carrier posts inbound SMS to. */
  smsWebhookUrl: string;
  /** Carrier-side label, e.g. `agent:agt_123` or `pool`. The MVP's tenancy model. */
  tag: string;
}

export type NumberBuyOptions = NumberConfigureOptions;

export interface PurchasedNumber extends NumberRef {
  monthlyCostUsd?: number;
}

export interface NumberMessagingEligibility {
  campaignId?: string;
  status: MessagingCampaignStatus;
}

export interface SentSms {
  /** Carrier pass-through surcharge, when the carrier reports it. */
  carrierFeeUsd?: number;
  /** Carrier-billed price for the message, when it is known at send time. */
  priceUsd?: number;
  providerMessageId: string;
  /** Billing segments (160 GSM-7 / 70 UCS-2 chars each). */
  segments: number;
}

export interface NumberInboundRequest {
  body: string;
  headers: Record<string, string | undefined>;
}

/** What a called number does with the call. */
export type VoiceCallMode = 'out-of-service' | 'unknown' | 'voicemail';

/** A synchronous carrier response to a voice webhook. */
export interface VoiceCallAnswer {
  body: string;
  contentType: string;
  /** What the call was answered with, for logs and operators. */
  mode: VoiceCallMode | 'rejected';
  status: number;
}

export interface InboundSms {
  from: string;
  media: { mimeType: string; url: string }[];
  providerMessageId: string;
  receivedAt: Date;
  /** Segments the carrier billed for receiving it; 0 for a transcribed voicemail. */
  segments: number;
  text: string;
  /** The agent's number the message was sent to — the routing key. */
  to: string;
}

export type NumberInboundParseResult =
  | { message: InboundSms; ok: true }
  /** Authentic, but not an inbound message (delivery receipt, our own echo). */
  | { ok: true; message: null }
  | { ok: false };

/**
 * GSM-7 vs UCS-2 segment count — what the carrier bills an SMS as. Used when
 * the carrier response does not echo the count (Twilio answers `num_segments`
 * reliably; this is the fallback and the pre-send budget estimate).
 */
const GSM7_EXTRA = new Set('£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¤¡ÄÖÑÜ§¿äöñüà€');

/** Printable ASCII, line breaks, and the GSM 03.38 extras — anything else forces UCS-2. */
const isGsm7 = (char: string) => {
  const code = char.codePointAt(0)!;
  return code === 10 || code === 13 || (code >= 32 && code <= 126) || GSM7_EXTRA.has(char);
};

export const countSmsSegments = (text: string): number => {
  if (!text) return 1;
  const chars = [...text];
  const length = chars.length;
  if (chars.every(isGsm7)) return length <= 160 ? 1 : Math.ceil(length / 153);
  return length <= 70 ? 1 : Math.ceil(length / 67);
};
