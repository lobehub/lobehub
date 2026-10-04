/**
 * Dedicated agent phone numbers — the paid "one agent, one number" product.
 *
 * A number is platform inventory before and after it belongs to an agent, so
 * it has its own lifecycle next to the `agent_accounts` row that exposes it as
 * the agent's `phone` identity:
 *
 * - `pooled`: bought ahead of demand in a common area code, webhooks already
 *   pointed at us, waiting to be handed out in seconds.
 * - `assigned`: bound to exactly one agent (tagged `agent:<id>` at the carrier).
 * - `quarantined`: the owner gave it up. It keeps receiving — and answers that
 *   the number is out of service — but is never assigned again until the
 *   quarantine ends, so the next owner does not get the previous owner's OTPs.
 * - `released`: returned to the carrier. Terminal.
 */
export const AGENT_PHONE_NUMBER_STATUSES = [
  'pooled',
  'assigned',
  'quarantined',
  'released',
] as const;
export type AgentPhoneNumberStatus = (typeof AGENT_PHONE_NUMBER_STATUSES)[number];

/** Carriers a deployment can buy dedicated numbers from. */
export const AGENT_NUMBER_PROVIDERS = ['twilio', 'telnyx'] as const;
export type AgentNumberProviderName = (typeof AGENT_NUMBER_PROVIDERS)[number];

/**
 * Where the number stands with US A2P 10DLC registration.
 *
 * Receiving is never gated by it — inbound SMS, OTPs and voice reach a fresh
 * number immediately. Sending application-to-person SMS from a US long code is:
 * carriers filter unregistered traffic, so outbound only opens once the number
 * sits on a campaign the carrier has `approved`. Nothing in the code assumes
 * approval; the status is read back from the carrier.
 */
export const MESSAGING_CAMPAIGN_STATUSES = ['none', 'pending', 'approved', 'rejected'] as const;
export type MessagingCampaignStatus = (typeof MESSAGING_CAMPAIGN_STATUSES)[number];

/** What a number costs, passed through to the agent that owns it. */
export const AGENT_NUMBER_CHARGE_TYPES = ['number_monthly', 'sms_segment', 'carrier_fee'] as const;
export type AgentNumberChargeType = (typeof AGENT_NUMBER_CHARGE_TYPES)[number];

/**
 * Why a phone account cannot send right now. Stored on the account's metadata
 * and surfaced verbatim to the UI and the model so neither pretends it can text.
 */
export type AgentAccountSendBlockedReason = 'messaging_campaign_not_approved';

/** The non-secret facts the account row carries about its dedicated number. */
export interface AgentDedicatedNumberMetadata {
  areaCode?: string;
  campaignStatus: MessagingCampaignStatus;
  numberId: string;
  sendBlockedReason?: AgentAccountSendBlockedReason;
}
