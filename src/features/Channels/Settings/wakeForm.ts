import type { ChannelWakeConfig } from '@/services/channel';

export const WAKE_TEXT_MAX_LENGTH = 4000;

export interface WakeFormValues {
  customInstructions: string;
  customInstructionsEnabled: boolean;
  duties: string;
  enabled: boolean;
  pace: NonNullable<ChannelWakeConfig['pace']>;
}

/**
 * A Channel with no stored strategy uses the defaults, which are the balanced pace. One stored
 * without a pace reads as custom, so numbers somebody tuned by hand are not overridden.
 */
export const toWakeForm = (stored: ChannelWakeConfig | null): WakeFormValues => ({
  customInstructions: stored?.customInstructions ?? '',
  // Older strategies hold the text without the switch: having text meant it was on.
  customInstructionsEnabled: stored?.customInstructionsEnabled ?? !!stored?.customInstructions,
  duties: stored?.duties?.text ?? '',
  enabled: stored?.enabled !== false,
  pace: stored ? (stored.pace ?? 'custom') : 'balanced',
});

/** The API replaces the whole strategy, so everything this form does not edit is carried over. */
export const applyWakeForm = (
  stored: ChannelWakeConfig | null,
  form: WakeFormValues,
): ChannelWakeConfig => {
  const duties = form.duties.trim();
  return {
    ...stored,
    customInstructions: form.customInstructions.trim(),
    customInstructionsEnabled: form.customInstructionsEnabled,
    enabled: form.enabled,
    pace: form.pace,
    // Other duty settings stay; a Channel that never had duties does not gain an empty block.
    ...(duties || stored?.duties ? { duties: { ...stored?.duties, text: duties } } : {}),
  };
};
