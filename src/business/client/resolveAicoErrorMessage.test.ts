import {
  AICO_ERROR_MESSAGES_FA,
  isAicoErrorCode,
  normalizeAicoErrorCode,
  resolveAicoErrorCode,
} from '@lobechat/business-const';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockToastError = vi.hoisted(() => vi.fn());

vi.mock('@lobehub/ui/base-ui', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

vi.mock('@/libs/better-auth/phone', () => ({
  buildPhoneVerifyRedirectUrl: (url: string) =>
    `/verify-phone?callbackUrl=${encodeURIComponent(url)}`,
}));

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

  it('includes personal funds codes with Persian defaults', () => {
    expect(AICO_ERROR_MESSAGES_FA.PERSONAL_FUNDS_UNAVAILABLE).toBe(
      'موجودی کیف پول شخصی کافی نیست. لطفاً شارژ کنید یا دوره آزمایشی را فعال کنید.',
    );
    expect(AICO_ERROR_MESSAGES_FA.MEMBER_BUDGET_UNFUNDED).toBe(
      'سهمیه سازمانی انتخاب‌شده موجودی ندارد.',
    );
    expect(isAicoErrorCode('PERSONAL_FUNDS_UNAVAILABLE')).toBe(true);
  });
});

describe('resolveAicoErrorMessage', () => {
  it('maps contract codes to Persian defaults without i18n', async () => {
    const { resolveAicoErrorMessage } = await import('./resolveAicoErrorMessage');
    expect(resolveAicoErrorMessage('BUDGET_EXCEEDED')).toBe('سهمیه‌ی شما تمام شده است.');
    expect(resolveAicoErrorMessage('ORG_WALLET_EMPTY')).toBe('موجودی کیف پول سازمان کافی نیست.');
    expect(resolveAicoErrorMessage('MODEL_NOT_ALLOWED:claude-sonnet')).toBe(
      'دسترسی به این مدل برای شما فعال نیست.',
    );
  });

  it('uses i18n when provided', async () => {
    const { resolveAicoErrorMessage } = await import('./resolveAicoErrorMessage');
    const t = (key: string) => (key === 'errors.TRIAL_ALREADY_USED' ? 'Trial used (en)' : key);
    expect(resolveAicoErrorMessage('TRIAL_ALREADY_USED', t)).toBe('Trial used (en)');
  });

  it('returns undefined for unknown errors so callers keep their fallback', async () => {
    const { resolveAicoErrorMessage } = await import('./resolveAicoErrorMessage');
    expect(resolveAicoErrorMessage(new Error('network down'))).toBeUndefined();
    expect(resolveAicoErrorMessage(undefined)).toBeUndefined();
  });

  it('reads message from TRPC-shaped errors', async () => {
    const { extractErrorCodeCandidate, resolveAicoErrorMessage } =
      await import('./resolveAicoErrorMessage');
    expect(extractErrorCodeCandidate({ message: 'PHONE_VERIFICATION_REQUIRED' })).toBe(
      'PHONE_VERIFICATION_REQUIRED',
    );
    expect(resolveAicoErrorMessage({ data: { message: 'PHONE_VERIFICATION_REQUIRED' } })).toBe(
      'برای ادامه، ابتدا شماره موبایل خود را تأیید کنید.',
    );
  });
});

describe('toastAicoError', () => {
  beforeEach(() => {
    mockToastError.mockReset();
    vi.stubGlobal('location', {
      assign: vi.fn(),
      pathname: '/wallet',
      search: '',
    });
  });

  it('adds a verify-phone action for PHONE_VERIFICATION_REQUIRED', async () => {
    const { toastAicoError } = await import('./resolveAicoErrorMessage');
    const t = (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue || key;

    toastAicoError({ message: 'PHONE_VERIFICATION_REQUIRED' }, t, 'wallet.trialFailed');

    expect(mockToastError).toHaveBeenCalledTimes(1);
    const arg = mockToastError.mock.calls[0][0] as {
      actions: Array<{ label: string; onClick: () => void }>;
      title: string;
    };
    expect(arg.title).toContain('موبایل');
    expect(arg.actions).toHaveLength(1);
    expect(arg.actions[0].label).toBe('Verify phone');

    arg.actions[0].onClick();
    expect(window.location.assign).toHaveBeenCalledWith('/verify-phone?callbackUrl=%2Fwallet');
  });

  it('keeps a plain string toast for other errors', async () => {
    const { toastAicoError } = await import('./resolveAicoErrorMessage');
    const t = (key: string) => key;

    toastAicoError(new Error('network'), t, 'wallet.trialFailed');

    expect(mockToastError).toHaveBeenCalledWith('wallet.trialFailed');
  });
});
