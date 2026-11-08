import type { ChannelWakeConfig } from '@/services/channel';

export const WAKE_INSTRUCTIONS_MAX_LENGTH = 4000;

export interface WakeFormValues {
  customInstructions: string;
  enabled: boolean;
  pace: NonNullable<ChannelWakeConfig['pace']>;
}

/**
 * A Channel with no stored strategy uses the defaults, which are the balanced pace. One stored
 * without a pace reads as custom, so numbers somebody tuned by hand are not overridden.
 */
export const toWakeForm = (stored: ChannelWakeConfig | null): WakeFormValues => ({
  customInstructions:
    stored?.customInstructionsEnabled === false ? '' : (stored?.customInstructions ?? ''),
  enabled: stored?.enabled !== false,
  pace: stored ? (stored.pace ?? 'custom') : 'balanced',
});

/** The API replaces the whole strategy, so everything this form does not edit is carried over. */
export const applyWakeForm = (
  stored: ChannelWakeConfig | null,
  form: WakeFormValues,
): ChannelWakeConfig => {
  const next: ChannelWakeConfig = { ...stored, enabled: form.enabled, pace: form.pace };
  // Untouched instructions stay as stored, including text that was switched off.
  if (form.customInstructions === toWakeForm(stored).customInstructions) return next;
  const customInstructions = form.customInstructions.trim();
  return { ...next, customInstructions, customInstructionsEnabled: !!customInstructions };
};
