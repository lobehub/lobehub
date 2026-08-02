import {
  AICO_ERROR_MESSAGES_FA,
  isAicoErrorCode,
  normalizeAicoErrorCode,
  resolveAicoErrorCode,
} from '@lobechat/business-const';
import { describe, expect, it } from 'vitest';

import { extractErrorCodeCandidate, resolveAicoErrorMessage } from './resolveAicoErrorMessage';

describe('Aico error catalog', () => {
  it('includes the three contract-required codes with Persian defaults', () => {
    expect(AICO_ERROR_MESSAGES_FA.BUDGET_EXCEEDED).toBe('سهمیه‌ی شما تمام شده است.');
    expect(AICO_ERROR_MESSAGES_FA.ORG_WALLET_EMPTY).toBe('موجودی کیف پول سازمان کافی نیست.');
    expect(AICO_ERROR_MESSAGES_FA.MODEL_NOT_ALLOWED).toBe('دسترسی به این مدل برای شما فعال نیست.');
  });

  it('normalizes and aliases server codes', () => {
    expect(normalizeAicoErrorCode('MODEL_NOT_ALLOWED:gpt-4')).toBe('MODEL_NOT_ALLOWED');
    expect(resolveAicoErrorCode('INSUFFICIENT_ORG_BALANCE')).toBe('ORG_WALLET_EMPTY');
    expect(isAicoErrorCode('BUDGET_EXCEEDED')).toBe(true);
    expect(resolveAicoErrorCode('not-a-code')).toBeUndefined();
  });
});

describe('resolveAicoErrorMessage', () => {
  it('maps contract codes to Persian defaults without i18n', () => {
    expect(resolveAicoErrorMessage('BUDGET_EXCEEDED')).toBe('سهمیه‌ی شما تمام شده است.');
    expect(resolveAicoErrorMessage('ORG_WALLET_EMPTY')).toBe('موجودی کیف پول سازمان کافی نیست.');
    expect(resolveAicoErrorMessage('MODEL_NOT_ALLOWED:claude-sonnet')).toBe(
      'دسترسی به این مدل برای شما فعال نیست.',
    );
  });

  it('uses i18n when provided', () => {
    const t = (key: string) => (key === 'errors.TRIAL_ALREADY_USED' ? 'Trial used (en)' : key);
    expect(resolveAicoErrorMessage('TRIAL_ALREADY_USED', t)).toBe('Trial used (en)');
  });

  it('returns undefined for unknown errors so callers keep their fallback', () => {
    expect(resolveAicoErrorMessage(new Error('network down'))).toBeUndefined();
    expect(resolveAicoErrorMessage(undefined)).toBeUndefined();
  });

  it('reads message from TRPC-shaped errors', () => {
    expect(extractErrorCodeCandidate({ message: 'PHONE_VERIFICATION_REQUIRED' })).toBe(
      'PHONE_VERIFICATION_REQUIRED',
    );
    expect(resolveAicoErrorMessage({ data: { message: 'PHONE_VERIFICATION_REQUIRED' } })).toBe(
      'برای ادامه، ابتدا شماره موبایل خود را تأیید کنید.',
    );
  });
});
