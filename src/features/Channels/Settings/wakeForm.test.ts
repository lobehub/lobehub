import { describe, expect, it } from 'vitest';

import { applyWakeForm, toWakeForm } from './wakeForm';

describe('toWakeForm', () => {
  it('reads a Channel with no strategy as the defaults', () => {
    expect(toWakeForm(null)).toEqual({ customInstructions: '', enabled: true, pace: 'balanced' });
  });

  it('reads a strategy without a pace as custom', () => {
    expect(toWakeForm({ enabled: false }).pace).toBe('custom');
  });

  it('shows no instructions when they are switched off', () => {
    const stored = { customInstructions: 'old', customInstructionsEnabled: false };
    expect(toWakeForm(stored).customInstructions).toBe('');
  });
});

describe('applyWakeForm', () => {
  it('keeps the fields the form does not edit', () => {
    const stored = { pace: 'calm' as const, rules: { scope: 'none' } };
    expect(applyWakeForm(stored, { ...toWakeForm(stored), enabled: false })).toEqual({
      enabled: false,
      pace: 'calm',
      rules: { scope: 'none' },
    });
  });

  it('keeps switched-off instructions when they were not edited', () => {
    const stored = { customInstructions: 'old', customInstructionsEnabled: false };
    expect(applyWakeForm(stored, toWakeForm(stored))).toMatchObject(stored);
  });

  it('switches instructions on when they are written and off when cleared', () => {
    const written = applyWakeForm(null, { ...toWakeForm(null), customInstructions: ' help ' });
    expect(written).toMatchObject({ customInstructions: 'help', customInstructionsEnabled: true });

    const stored = { customInstructions: 'old', customInstructionsEnabled: true };
    expect(applyWakeForm(stored, { ...toWakeForm(stored), customInstructions: '' })).toMatchObject({
      customInstructions: '',
      customInstructionsEnabled: false,
    });
  });
});
