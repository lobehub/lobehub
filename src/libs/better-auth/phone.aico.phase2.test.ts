/**
 * Aico Phase 2 — Phone normalize adversarial cases
 * Maps: AICO-P1-020
 */
import { describe, expect, it } from 'vitest';

import { normalizeIranianPhoneNumber } from './phone';

describe('Iranian phone normalize adversarial (Phase 2)', () => {
  it('AICO-P1-020: Persian digits normalize to E.164', () => {
    expect(normalizeIranianPhoneNumber('۰۹۱۲۱۱１１۱۱۱')).toBe('+989121111111');
  });

  it('AICO-P1-020: Arabic-Indic digits normalize to E.164', () => {
    expect(normalizeIranianPhoneNumber('٠٩١٢١١١١١١١')).toBe('+989121111111');
  });

  it('AICO-P1-020: ASCII local and E.164 variants normalize', () => {
    expect(normalizeIranianPhoneNumber('09121111111')).toBe('+989121111111');
    expect(normalizeIranianPhoneNumber('+989121111111')).toBe('+989121111111');
    expect(normalizeIranianPhoneNumber('0912-111-1111')).toBe('+989121111111');
  });

  it('AICO-P1-020: bare country-code without plus should normalize', () => {
    expect(normalizeIranianPhoneNumber('989121111111')).toBe('+989121111111');
  });
});
