import { describe, expect, it } from 'vitest';

import { normalizeIranianPhoneNumber } from '../phone';

describe('normalizeIranianPhoneNumber (final remediation)', () => {
  it('accepts UI local form 09…', () => {
    expect(normalizeIranianPhoneNumber('09121234567')).toBe('+989121234567');
  });

  it('maps Persian digits', () => {
    expect(normalizeIranianPhoneNumber('۰۹۱۲۱۲۳۴۵۶۷')).toBe('+989121234567');
  });

  it('maps Arabic-Indic digits', () => {
    expect(normalizeIranianPhoneNumber('٠٩١٢١٢٣٤٥٦٧')).toBe('+989121234567');
  });

  it('accepts bare country code without plus', () => {
    expect(normalizeIranianPhoneNumber('989121234567')).toBe('+989121234567');
  });

  it('accepts E.164 and strips separators', () => {
    expect(normalizeIranianPhoneNumber('+98 912 123-4567')).toBe('+989121234567');
  });

  it('rejects landlines / foreign', () => {
    expect(normalizeIranianPhoneNumber('02188776655')).toBeNull();
    expect(normalizeIranianPhoneNumber('+14155552671')).toBeNull();
  });
});
