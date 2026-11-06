import type { LobeAgentAgencyConfig } from '@lobechat/types';
import { toRecord } from '@lobechat/utils/object';
import { translateLegacyReasoningConfig } from 'model-bank/aiModel';

/**
 * Moves the legacy per-model effort keys a released client still writes in a
 * sub-agent override (`gpt5_2ReasoningEffort`, ...) to `reasoningEffort`,
 * reading the key the sub-agent's model used, so the new runtime honors the
 * pick instead of ignoring it.
 */
export const translateSubAgentLegacyEffort = <T extends LobeAgentAgencyConfig | null | undefined>(
  agencyConfig: T,
): T => {
  const subagent = agencyConfig?.subagent;
  const chatConfig = toRecord(subagent?.chatConfig);
  if (!subagent || !chatConfig) return agencyConfig;

  const next = translateLegacyReasoningConfig(chatConfig, {
    model: subagent.model,
    provider: subagent.provider,
  });
  if (next === chatConfig) return agencyConfig;

  return { ...agencyConfig, subagent: { ...subagent, chatConfig: next } };
};
