import type { AgentAccountSettings, AgentAccountWakeMode } from '@lobechat/types';
import { AGENT_ACCOUNT_DIGEST_MINUTES_RANGE, AGENT_ACCOUNT_WAKE_MODES } from '@lobechat/types';
import { z } from 'zod';

import { normalizeMailAddress } from '@/database/models/agentMail';

/** Digest window when the owner set none. */
export const DEFAULT_DIGEST_MINUTES = 60;

/** Most senders one account may list; the list is matched on every delivery. */
export const MAX_WAKE_SENDERS = 200;

/** A full address (`a@b.com`) or a whole domain (`@b.com`). */
const WAKE_SENDER_PATTERN = /^[^\s@]*@[^\s@]+\.[^\s@]+$/;

/** What a write must look like. Reads use {@link resolveWakeConfig}, which never throws. */
export const agentAccountSettingsSchema = z
  .object({
    wake: z
      .object({
        digestMinutes: z
          .number()
          .int()
          .min(AGENT_ACCOUNT_DIGEST_MINUTES_RANGE.min)
          .max(AGENT_ACCOUNT_DIGEST_MINUTES_RANGE.max)
          .optional(),
        mode: z.enum(AGENT_ACCOUNT_WAKE_MODES).optional(),
        wakeSenders: z
          .array(z.string().trim().toLowerCase().regex(WAKE_SENDER_PATTERN))
          .max(MAX_WAKE_SENDERS)
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/** The wake rules of one account with every default applied. */
export interface ResolvedWakeConfig {
  digestMs: number;
  mode: AgentAccountWakeMode;
  /** Lowercased; a leading `@` marks a whole domain. */
  wakeSenders: string[];
}

/**
 * Reads an account's wake rules. Settings are stored JSON that may predate a field or carry a
 * value a later build no longer accepts, so anything malformed falls back to its default instead
 * of failing the delivery.
 */
export const resolveWakeConfig = (
  settings: AgentAccountSettings | null | undefined,
): ResolvedWakeConfig => {
  const wake = settings?.wake;
  const mode = (AGENT_ACCOUNT_WAKE_MODES as readonly string[]).includes(wake?.mode ?? '')
    ? (wake!.mode as AgentAccountWakeMode)
    : 'on';

  const minutes = Number.isInteger(wake?.digestMinutes)
    ? Math.min(
        AGENT_ACCOUNT_DIGEST_MINUTES_RANGE.max,
        Math.max(AGENT_ACCOUNT_DIGEST_MINUTES_RANGE.min, wake!.digestMinutes!),
      )
    : DEFAULT_DIGEST_MINUTES;

  const wakeSenders = Array.isArray(wake?.wakeSenders)
    ? wake.wakeSenders
        .filter((sender): sender is string => typeof sender === 'string')
        .map((sender) => normalizeMailAddress(sender))
        .filter((sender) => WAKE_SENDER_PATTERN.test(sender))
    : [];

  return { digestMs: minutes * 60_000, mode, wakeSenders };
};

/** Whether `from` is one of the listed senders, by full address or by domain. */
export const isWakeSender = (from: string, wakeSenders: readonly string[]): boolean => {
  const address = normalizeMailAddress(from);
  const domain = address.slice(address.lastIndexOf('@'));

  return wakeSenders.some((sender) =>
    sender.startsWith('@') ? domain === sender : address === sender,
  );
};
