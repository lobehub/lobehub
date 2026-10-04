import type {
  AgentAccountCapabilities,
  AgentDedicatedNumberMetadata,
  AgentNumberChargeType,
} from '@lobechat/types';
import debug from 'debug';
import { and, eq, ne } from 'drizzle-orm';

import {
  authorizeDedicatedNumber,
  checkAgentNumberSpendAllowance,
  onDedicatedNumberUnsubscribed,
  recordAgentNumberCharge,
} from '@/business/server/agent-identity/dedicatedNumber';
import type { AgentPhoneNumberOwner } from '@/database/models/agentPhoneNumber';
import { AgentNumberChargeModel, AgentPhoneNumberModel } from '@/database/models/agentPhoneNumber';
import type { AgentPhoneNumberItem } from '@/database/schemas';
import { agentAccounts } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { AgentAccountError } from '../errors';
import type {
  InboundSms,
  NumberInboundRequest,
  NumberProvider,
  NumberRef,
  SentSms,
  VoiceCallAnswer,
} from './types';
import { countSmsSegments } from './types';

const log = debug('lobe-server:agent-identity:numbers');

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What the quarantined number answers, once per sender per day. Kept within
 * one UCS-2 segment (70 chars): the platform pays for it, not the old owner.
 */
export const QUARANTINE_AUTO_REPLY = 'This number is no longer in service. 此号码已停用。';

export interface DedicatedNumberSettings {
  country: string;
  limits: {
    /** Outbound SMS segments one agent may send per rolling day. */
    dailyOutboundSegments: number;
    /** USD one agent's number may cost per calendar month. */
    monthlySpendUsd: number;
  };
  /** Area codes the warm pool is kept stocked in. */
  poolAreaCodes: string[];
  /** Numbers kept ready per area code. */
  poolSize: number;
  pricing: { carrierFeeUsd: number; monthlyFeeUsd: number; smsSegmentUsd: number };
  /** Days a given-up number stays quarantined before it is released (30–60). */
  quarantineDays: number;
  /** The inbound SMS URL for this carrier. */
  smsWebhookUrl: string;
}

export interface DedicatedNumberServiceOptions {
  now?: () => Date;
}

/** What a pool top-up did, per area code. */
export interface PoolReplenishReport {
  areaCode: string;
  bought: string[];
  failed?: string;
  pooledBefore: number;
}

export type QuarantinedInboundResult =
  | { autoReplied: true; numberId: string; outcome: 'quarantined' }
  | {
      autoReplied: false;
      numberId: string;
      outcome: 'quarantined';
      /** Why no reply went out — outbound is gated even for the courtesy reply. */
      reason: 'already-replied-today' | 'messaging-not-approved' | 'reply-failed';
    }
  | { outcome: 'not-quarantined' | 'rejected' };

const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
const monthKey = (now: Date) => now.toISOString().slice(0, 7);

const toRef = (number: AgentPhoneNumberItem): NumberRef => ({
  phoneNumber: number.phoneNumber,
  providerNumberId: number.providerNumberId,
});

/**
 * The paid dedicated number: one agent, one number, bought from a carrier API.
 *
 * Owns everything between "the user paid" and "the carrier holds a number":
 *
 * - **Allocation** — claim a warm-pool number in seconds, or buy one on demand
 *   when the pool for that area code is dry; retag it with its agent.
 * - **Graded capability** — receiving works the moment the number exists;
 *   sending opens only when the carrier reports an approved 10DLC campaign.
 * - **Quarantine** — a given-up number keeps answering "out of service" for
 *   30–60 days and is only then released, so the next owner never receives
 *   the previous owner's verification codes.
 * - **Billing** — monthly fee, per-segment price and carrier surcharges are
 *   recorded per agent, mirrored to the business spend ledger, and capped.
 */
export class DedicatedNumberService {
  readonly carrier: NumberProvider;
  private readonly charges: AgentNumberChargeModel;
  private readonly db: LobeChatDatabase;
  private readonly numbers: AgentPhoneNumberModel;
  private readonly now: () => Date;
  readonly settings: DedicatedNumberSettings;

  constructor(
    db: LobeChatDatabase,
    carrier: NumberProvider,
    settings: DedicatedNumberSettings,
    options: DedicatedNumberServiceOptions = {},
  ) {
    this.db = db;
    this.carrier = carrier;
    this.settings = settings;
    this.now = options.now ?? (() => new Date());
    this.numbers = new AgentPhoneNumberModel(db);
    this.charges = new AgentNumberChargeModel(db);
  }

  private tagFor = (agentId: string) => `agent:${agentId}`;

  // --------------- Allocation ---------------

  /**
   * Give an agent its number. Pool first (seconds), carrier purchase second
   * (still synchronous — the carrier API sells a number in one call).
   */
  allocate = async (
    owner: AgentPhoneNumberOwner,
    options: { areaCode?: string } = {},
  ): Promise<{ number: AgentPhoneNumberItem; source: 'instant' | 'pool' }> => {
    const authorization = await authorizeDedicatedNumber({
      agentId: owner.agentId,
      areaCode: options.areaCode,
      provider: this.carrier.name,
      userId: owner.userId,
      workspaceId: owner.workspaceId ?? undefined,
    });
    if (!authorization.allowed) {
      throw new AgentAccountError(
        'payment_required',
        authorization.reason ?? 'A dedicated number needs an active number subscription.',
      );
    }

    let number = await this.numbers.claimPooled(this.carrier.name, owner, options.areaCode);
    let source: 'instant' | 'pool' = 'pool';

    if (number) {
      // Pool numbers are tagged `pool`; the carrier console should name the owner.
      try {
        await this.carrier.configureWebhook(toRef(number), {
          smsWebhookUrl: this.settings.smsWebhookUrl,
          tag: this.tagFor(owner.agentId),
        });
      } catch (error) {
        await this.numbers.returnToPool(number.id);
        throw error;
      }
    } else {
      number = await this.buyInstant(owner, options.areaCode);
      source = 'instant';
    }

    number = await this.refreshEligibility(number);
    await this.chargeMonthly(number);

    log('allocated %s (%s) to agent %s', number.phoneNumber, source, owner.agentId);
    return { number, source };
  };

  private buyInstant = async (
    owner: AgentPhoneNumberOwner,
    areaCode?: string,
  ): Promise<AgentPhoneNumberItem> => {
    const [candidate] = await this.carrier.search({
      areaCode,
      country: this.settings.country,
      limit: 1,
    });
    if (!candidate) {
      throw new AgentAccountError(
        'capacity_exhausted',
        areaCode
          ? `No number is available in area code ${areaCode} right now. Try another area code.`
          : 'The carrier has no number available right now. Try again shortly.',
      );
    }

    const purchased = await this.carrier.buy(candidate.phoneNumber, {
      smsWebhookUrl: this.settings.smsWebhookUrl,
      tag: this.tagFor(owner.agentId),
    });

    const now = this.now();
    const number = await this.numbers.insert({
      agentId: owner.agentId,
      areaCode: areaCode ?? null,
      assignedAt: now,
      country: this.settings.country,
      monthlyCostUsd: purchased.monthlyCostUsd ?? candidate.monthlyCostUsd ?? null,
      phoneNumber: purchased.phoneNumber,
      provider: this.carrier.name,
      providerNumberId: purchased.providerNumberId,
      purchasedAt: now,
      status: 'assigned',
      userId: owner.userId,
      workspaceId: owner.workspaceId ?? null,
    });

    // Buying points the webhook; configuring also joins the 10DLC messaging
    // service, without which the number could never become send-capable.
    await this.carrier.configureWebhook(toRef(number), {
      smsWebhookUrl: this.settings.smsWebhookUrl,
      tag: this.tagFor(owner.agentId),
    });
    return number;
  };

  /** Link the inventory row to the account row that now exposes it. */
  bindAccount = (numberId: string, accountId: string) =>
    this.numbers.attachAccount(numberId, accountId);

  /** The account row could not be written: the number never served anyone. */
  returnToPool = async (numberId: string) => {
    const number = await this.numbers.findById(numberId);
    if (!number) return;
    await this.numbers.returnToPool(numberId);
    await this.carrier
      .configureWebhook(toRef(number), { smsWebhookUrl: this.settings.smsWebhookUrl, tag: 'pool' })
      .catch((error) => log('retag to pool failed for %s: %O', number.phoneNumber, error));
  };

  // --------------- Quarantine & release ---------------

  /**
   * The owner gave the number up. It stops belonging to the agent at once but
   * stays held — answering "out of service" — until the quarantine ends.
   */
  quarantine = async (numberId: string): Promise<AgentPhoneNumberItem | undefined> => {
    const until = new Date(this.now().getTime() + this.settings.quarantineDays * DAY_MS);
    const number = await this.numbers.quarantine(numberId, until);
    if (!number) return undefined;

    await this.carrier
      .configureWebhook(toRef(number), {
        smsWebhookUrl: this.settings.smsWebhookUrl,
        tag: `quarantine:${until.toISOString().slice(0, 10)}`,
      })
      .catch((error) => log('retag to quarantine failed for %s: %O', number.phoneNumber, error));

    await onDedicatedNumberUnsubscribed({
      agentId: number.agentId,
      numberId: number.id,
      userId: number.userId,
    });

    log('quarantined %s until %s', number.phoneNumber, until.toISOString());
    return number;
  };

  /** Release every number whose quarantine has ended. Run on a schedule. */
  releaseExpired = async (): Promise<{ failed: string[]; released: string[] }> => {
    const expired = await this.numbers.listQuarantineExpired(this.now());
    const released: string[] = [];
    const failed: string[] = [];

    for (const number of expired) {
      if (number.provider !== this.carrier.name) continue;
      try {
        await this.carrier.release(toRef(number));
        await this.numbers.markReleased(number.id);
        released.push(number.phoneNumber);
      } catch (error) {
        log('release failed for %s: %O', number.phoneNumber, error);
        failed.push(number.phoneNumber);
      }
    }

    return { failed, released };
  };

  /**
   * A message reached a number no live account routes on. If the number is in
   * quarantine, answer — once per sender per day, and only when the number may
   * send at all — that it is out of service. Nothing reaches any agent.
   */
  handleUnroutedInbound = async (inbound: InboundSms): Promise<QuarantinedInboundResult> => {
    const number = await this.numbers.findLiveByNumber(this.carrier.name, inbound.to);
    if (!number || number.status !== 'quarantined') return { outcome: 'not-quarantined' };

    if (number.campaignStatus !== 'approved') {
      return {
        autoReplied: false,
        numberId: number.id,
        outcome: 'quarantined',
        reason: 'messaging-not-approved',
      };
    }

    const replied = (number.metadata?.autoReplied ?? {}) as Record<string, string>;
    const last = replied[inbound.from];
    if (last && this.now().getTime() - new Date(last).getTime() < DAY_MS) {
      return {
        autoReplied: false,
        numberId: number.id,
        outcome: 'quarantined',
        reason: 'already-replied-today',
      };
    }

    try {
      await this.carrier.send(toRef(number), { text: QUARANTINE_AUTO_REPLY, to: inbound.from });
    } catch (error) {
      log('quarantine auto-reply failed for %s: %O', number.phoneNumber, error);
      return {
        autoReplied: false,
        numberId: number.id,
        outcome: 'quarantined',
        reason: 'reply-failed',
      };
    }

    await this.updateMetadata(number, {
      autoReplied: { ...replied, [inbound.from]: this.now().toISOString() },
    });
    return { autoReplied: true, numberId: number.id, outcome: 'quarantined' };
  };

  /**
   * Answer an inbound call on one of our numbers. An assigned number takes a
   * voicemail whose transcript arrives through the SMS webhook (and so wakes
   * the agent like a text); a quarantined one says it is out of service.
   * Voice is not 10DLC-gated, so neither depends on the campaign.
   */
  answerVoiceCall = async (request: NumberInboundRequest): Promise<VoiceCallAnswer | undefined> =>
    this.carrier.answerVoiceCall?.(request, async (to) => {
      const number = await this.numbers.findLiveByNumber(this.carrier.name, to);
      if (number?.status === 'assigned') return 'voicemail';
      if (number?.status === 'quarantined') return 'out-of-service';
      return 'unknown';
    });

  // --------------- Warm pool ---------------

  /** Top every configured area code up to the pool size. Run on a schedule. */
  replenishPool = async (): Promise<PoolReplenishReport[]> => {
    const reports: PoolReplenishReport[] = [];

    for (const areaCode of this.settings.poolAreaCodes) {
      const pooledBefore = await this.numbers.countPooled(this.carrier.name, areaCode);
      const deficit = Math.max(0, this.settings.poolSize - pooledBefore);
      const report: PoolReplenishReport = { areaCode, bought: [], pooledBefore };
      reports.push(report);
      if (deficit === 0) continue;

      try {
        const candidates = await this.carrier.search({
          areaCode,
          country: this.settings.country,
          limit: deficit,
        });
        for (const candidate of candidates.slice(0, deficit)) {
          const purchased = await this.carrier.buy(candidate.phoneNumber, {
            smsWebhookUrl: this.settings.smsWebhookUrl,
            tag: 'pool',
          });
          await this.numbers.insert({
            areaCode,
            country: this.settings.country,
            monthlyCostUsd: purchased.monthlyCostUsd ?? candidate.monthlyCostUsd ?? null,
            phoneNumber: purchased.phoneNumber,
            provider: this.carrier.name,
            providerNumberId: purchased.providerNumberId,
            purchasedAt: this.now(),
            status: 'pooled',
          });
          report.bought.push(purchased.phoneNumber);
        }
      } catch (error) {
        report.failed = error instanceof Error ? error.message : String(error);
        log('pool top-up failed for %s: %O', areaCode, error);
      }
    }

    return reports;
  };

  // --------------- 10DLC eligibility ---------------

  /**
   * Read the number's campaign standing from the carrier and mirror it onto
   * the inventory row and the agent's account. This is the only place `send`
   * ever flips to true.
   */
  refreshEligibility = async (number: AgentPhoneNumberItem): Promise<AgentPhoneNumberItem> => {
    let eligibility: Awaited<ReturnType<NumberProvider['messagingEligibility']>>;
    try {
      eligibility = await this.carrier.messagingEligibility(toRef(number));
    } catch (error) {
      // Unknown is not approved: keep the number receive-only.
      log('eligibility read failed for %s: %O', number.phoneNumber, error);
      eligibility = {
        status: number.campaignStatus === 'approved' ? 'pending' : number.campaignStatus,
      };
    }

    await this.numbers.updateCampaign(number.id, {
      campaignId: eligibility.campaignId,
      status: eligibility.status,
    });
    const updated = {
      ...number,
      campaignId: eligibility.campaignId ?? null,
      campaignStatus: eligibility.status,
    };

    await this.syncAccount(updated);
    return updated;
  };

  /** Refresh every assigned number (e.g. after the campaign was approved). */
  refreshAllEligibility = async (): Promise<{ approved: number; checked: number }> => {
    const assigned = await this.numbers.listByStatus('assigned', this.carrier.name);
    let approved = 0;
    for (const number of assigned) {
      const updated = await this.refreshEligibility(number);
      if (updated.campaignStatus === 'approved') approved += 1;
    }
    return { approved, checked: assigned.length };
  };

  /** The capability + metadata an account exposing this number must carry. */
  accountFacts = (
    number: AgentPhoneNumberItem,
  ): { capabilities: AgentAccountCapabilities; metadata: AgentDedicatedNumberMetadata } => {
    const canSend = number.campaignStatus === 'approved';
    return {
      capabilities: { receive: true, send: canSend },
      metadata: {
        areaCode: number.areaCode ?? undefined,
        campaignStatus: number.campaignStatus,
        numberId: number.id,
        ...(canSend ? {} : { sendBlockedReason: 'messaging_campaign_not_approved' as const }),
      },
    };
  };

  private syncAccount = async (number: AgentPhoneNumberItem) => {
    const facts = this.accountFacts(number);
    await this.db
      .update(agentAccounts)
      .set({
        capabilities: facts.capabilities,
        metadata: { ...facts.metadata },
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(agentAccounts.kind, 'phone'),
          eq(agentAccounts.provider, number.provider),
          eq(agentAccounts.identifier, number.phoneNumber),
          ne(agentAccounts.status, 'revoked'),
        ),
      );
  };

  // --------------- Messaging + billing ---------------

  findNumber = (numberId: string) => this.numbers.findById(numberId);

  /**
   * Send from an agent's number: refuse unless the campaign is approved, the
   * agent is inside its caps, and the deployment budget admits it; then bill.
   */
  send = async (numberId: string, message: { text: string; to: string }): Promise<SentSms> => {
    const number = await this.numbers.findById(numberId);
    if (!number || number.status !== 'assigned' || !number.agentId || !number.userId) {
      throw new Error(`Dedicated number ${numberId} is not assigned to an agent`);
    }

    if (number.campaignStatus !== 'approved') {
      throw new AgentAccountError(
        'send_not_enabled',
        `${number.phoneNumber} can receive but cannot send SMS yet: it is not on an approved ` +
          '10DLC campaign. Outbound opens once the carrier approves the campaign.',
      );
    }

    const segments = countSmsSegments(message.text);
    await this.assertWithinCaps(number, segments);

    const sent = await this.carrier.send(toRef(number), message);
    await this.recordSmsCharges(number, sent.providerMessageId, sent.segments, 'outbound', sent);
    return sent;
  };

  /** Bill the segments a received message cost. Idempotent per carrier message id. */
  recordInbound = async (number: AgentPhoneNumberItem, inbound: InboundSms) =>
    this.recordSmsCharges(number, inbound.providerMessageId, inbound.segments, 'inbound');

  findLiveNumber = (phoneNumber: string) =>
    this.numbers.findLiveByNumber(this.carrier.name, phoneNumber);

  /** Bill the monthly fee for every assigned number. Idempotent per month. */
  chargeMonthlyFees = async (): Promise<{ charged: number }> => {
    const assigned = await this.numbers.listByStatus('assigned', this.carrier.name);
    let charged = 0;
    for (const number of assigned) {
      if (await this.chargeMonthly(number)) charged += 1;
    }
    return { charged };
  };

  private chargeMonthly = async (number: AgentPhoneNumberItem): Promise<boolean> => {
    if (!number.userId) return false;
    const now = this.now();
    return this.recordCharge(number, {
      amountUsd: this.settings.pricing.monthlyFeeUsd,
      externalId: `monthly:${number.id}:${number.agentId}:${monthKey(now)}`,
      metadata: { carrierMonthlyCostUsd: number.monthlyCostUsd ?? undefined, month: monthKey(now) },
      quantity: 1,
      type: 'number_monthly',
    });
  };

  private recordSmsCharges = async (
    number: AgentPhoneNumberItem,
    messageId: string,
    segments: number,
    direction: 'inbound' | 'outbound',
    sent?: SentSms,
  ) => {
    // A transcribed voicemail is not an SMS: nothing per-segment to bill.
    if (segments === 0) return;
    const { carrierFeeUsd, smsSegmentUsd } = this.settings.pricing;
    await this.recordCharge(number, {
      amountUsd: segments * smsSegmentUsd,
      externalId: `sms:${direction}:${messageId}`,
      metadata: { carrierPriceUsd: sent?.priceUsd, direction },
      quantity: segments,
      type: 'sms_segment',
    });
    // US carriers levy their pass-through fee on A2P traffic, i.e. outbound.
    if (direction === 'outbound') {
      await this.recordCharge(number, {
        amountUsd: sent?.carrierFeeUsd ?? segments * carrierFeeUsd,
        externalId: `carrier:${direction}:${messageId}`,
        metadata: { direction },
        quantity: segments,
        type: 'carrier_fee',
      });
    }
  };

  private recordCharge = async (
    number: AgentPhoneNumberItem,
    charge: {
      amountUsd: number;
      externalId: string;
      metadata?: Record<string, unknown>;
      quantity: number;
      type: AgentNumberChargeType;
    },
  ): Promise<boolean> => {
    if (!number.userId) return false;
    const occurredAt = this.now();
    const { created } = await this.charges.record({
      agentId: number.agentId,
      amountUsd: charge.amountUsd,
      externalId: charge.externalId,
      metadata: charge.metadata ?? {},
      numberId: number.id,
      occurredAt,
      quantity: charge.quantity,
      type: charge.type,
      userId: number.userId,
      workspaceId: number.workspaceId,
    });

    if (created) {
      await recordAgentNumberCharge({
        agentId: number.agentId,
        amountUsd: charge.amountUsd,
        externalId: charge.externalId,
        numberId: number.id,
        occurredAt,
        quantity: charge.quantity,
        type: charge.type,
        userId: number.userId,
        workspaceId: number.workspaceId,
      });
    }
    return created;
  };

  /** Anti-abuse: a monthly USD ceiling and a daily outbound volume ceiling, per agent. */
  private assertWithinCaps = async (number: AgentPhoneNumberItem, segments: number) => {
    const agentId = number.agentId!;
    const now = this.now();
    const { carrierFeeUsd, smsSegmentUsd } = this.settings.pricing;
    const estimate = segments * (smsSegmentUsd + carrierFeeUsd);

    const [monthSpend, daySegments] = await Promise.all([
      this.charges.sumForAgentSince(agentId, monthStart(now)),
      this.charges.outboundSegmentsSince(agentId, new Date(now.getTime() - DAY_MS)),
    ]);

    if (monthSpend + estimate > this.settings.limits.monthlySpendUsd) {
      throw new AgentAccountError(
        'spend_limit_reached',
        `This agent's number reached its monthly limit of $${this.settings.limits.monthlySpendUsd.toFixed(2)} ` +
          `($${monthSpend.toFixed(4)} used). Sending resumes next month.`,
      );
    }
    if (daySegments + segments > this.settings.limits.dailyOutboundSegments) {
      throw new AgentAccountError(
        'spend_limit_reached',
        `This agent's number reached its daily limit of ${this.settings.limits.dailyOutboundSegments} SMS segments.`,
      );
    }

    const budget = await checkAgentNumberSpendAllowance({
      agentId,
      estimatedUsd: estimate,
      type: 'sms_segment',
      userId: number.userId!,
      workspaceId: number.workspaceId ?? undefined,
    });
    if (!budget.allowed) {
      throw new AgentAccountError(
        'spend_limit_reached',
        'Your spend budget does not cover this SMS.',
      );
    }
  };

  private updateMetadata = (number: AgentPhoneNumberItem, patch: Record<string, unknown>) =>
    this.numbers.setMetadata(number.id, { ...number.metadata, ...patch });
}
