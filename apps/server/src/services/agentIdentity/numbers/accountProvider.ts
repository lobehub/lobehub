import type {
  AgentAccountInboundEvent,
  AgentAccountInboundMessage,
  AgentAccountProvider,
  AgentAccountProvisionInput,
  AgentAccountProvisionResult,
  AgentAccountRef,
} from '@lobechat/types';

import type { DedicatedNumberService } from './service';
import type { InboundSms } from './types';

/** Area codes are three digits in the NANP; anything else is not a preference we can honour. */
const AREA_CODE = /^\d{3}$/;

const numberIdOf = (ref: AgentAccountRef): string | undefined =>
  typeof ref.metadata?.numberId === 'string' ? ref.metadata.numberId : undefined;

/**
 * The dedicated number as an agent identity: plugs a carrier (via
 * {@link DedicatedNumberService}) into the account registry as a `phone`
 * provider named after the carrier (`twilio`, `telnyx`).
 *
 * The account row is the agent-facing view; the number service owns the
 * number. Revoking the account therefore does not release the number — it
 * moves it into quarantine, and the scheduled release returns it to the
 * carrier only after the quarantine ends.
 */
export const createDedicatedNumberAccountProvider = (
  numbers: DedicatedNumberService,
): AgentAccountProvider<'phone'> => ({
  /**
   * The ceiling, not the promise: a fresh number receives at once, and each
   * account narrows `send` to what its carrier campaign actually allows.
   */
  capabilities: { receive: true, send: false },
  kind: 'phone',
  provider: numbers.carrier.name,

  provision: async (input: AgentAccountProvisionInput): Promise<AgentAccountProvisionResult> => {
    // For a number, the "preferred handle" the caller may ask for is an area code.
    const areaCode = input.prefix && AREA_CODE.test(input.prefix) ? input.prefix : undefined;
    if (input.prefix && !areaCode) {
      throw new Error(`"${input.prefix}" is not a 3-digit area code.`);
    }

    const { number, source } = await numbers.allocate(
      { agentId: input.agentId, userId: input.userId, workspaceId: input.workspaceId },
      { areaCode },
    );
    const facts = numbers.accountFacts(number);

    return {
      capabilities: facts.capabilities,
      identifier: number.phoneNumber,
      metadata: { ...facts.metadata, allocatedFrom: source },
    };
  },

  onProvisioned: async (ref: AgentAccountRef) => {
    const numberId = numberIdOf(ref);
    if (numberId) await numbers.bindAccount(numberId, ref.id);
  },

  release: async (ref: AgentAccountRef) => {
    const numberId = numberIdOf(ref);
    if (!numberId) return;
    // No account row was ever written (the service is compensating a failed
    // create): nobody held the number, so it goes straight back to the pool.
    if (!ref.id) {
      await numbers.returnToPool(numberId);
      return;
    }
    await numbers.quarantine(numberId);
  },

  send: async (ref, message) => {
    const numberId = numberIdOf(ref);
    if (!numberId)
      throw new Error(`Phone account ${ref.identifier} has no dedicated number record`);

    const sent = await numbers.send(numberId, { text: message.text, to: message.to });
    return { providerMessageId: sent.providerMessageId };
  },

  resolveInboundIdentifier: (request) => numbers.carrier.peekRecipient(request.body),

  verifyInbound: async (request): Promise<AgentAccountInboundEvent | null> => {
    const parsed = await numbers.carrier.parseInbound(request);
    if (!parsed.ok) return null;
    // Authentic but not a message (a receipt): acknowledged, produces nothing.
    if (!parsed.message) return { eventId: 'non-message', payload: null };
    // Replays are absorbed downstream: the inbox is unique per carrier message id.
    return { eventId: parsed.message.providerMessageId, payload: parsed.message };
  },

  normalizeInbound: async (
    event: AgentAccountInboundEvent,
    ref: AgentAccountRef,
  ): Promise<AgentAccountInboundMessage | null> => {
    const sms = event.payload as InboundSms | null;
    if (!sms) return null;

    const numberId = numberIdOf(ref);
    const number = numberId ? await numbers.findNumber(numberId) : undefined;
    if (number) await numbers.recordInbound(number, sms);

    return {
      attachments:
        sms.media.length > 0
          ? sms.media.map((item) => ({ mimeType: item.mimeType, url: item.url }))
          : undefined,
      from: sms.from,
      providerMessageId: sms.providerMessageId,
      receivedAt: sms.receivedAt,
      text: sms.text,
      // SMS has no thread id; the counterpart's number is the conversation.
      threadKey: sms.from,
      to: ref.identifier,
    };
  },

  handleUnroutedInbound: async (request) => {
    const parsed = await numbers.carrier.parseInbound(request);
    if (!parsed.ok) return { outcome: 'rejected' };
    if (!parsed.message) return { outcome: 'not-handled' };

    const result = await numbers.handleUnroutedInbound(parsed.message);
    if (result.outcome !== 'quarantined') return { outcome: 'not-handled' };

    return {
      detail: result.autoReplied ? 'auto-replied' : result.reason,
      outcome: 'quarantined',
    };
  },
});
