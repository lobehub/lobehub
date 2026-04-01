export interface PhoneAuthResult {
  data?: unknown;
  errorMessage?: string;
  success: boolean;
}

type AuthTranslate = (...args: any[]) => string;

export const normalizeAuthCallbackUrl = (callbackUrl: string): string => {
  if (typeof window !== 'undefined' && callbackUrl === '/') {
    return `${window.location.origin}/`;
  }

  return callbackUrl;
};

export const getPhoneAuthErrorMessage = (t: AuthTranslate, error: string) => {
  switch (error) {
    case 'Invalid OTP': {
      return t('betterAuth.errors.otpInvalid');
    }
    case 'Invalid phone number': {
      return t('betterAuth.errors.phoneInvalid');
    }
    case 'Invalid phone number or password': {
      return t('betterAuth.errors.loginFailed');
    }
    case "This phone number isn't registered":
    case "The phone number isn't registered": {
      return t('betterAuth.errors.phoneNotRegistered');
    }
    case 'Phone number already exists': {
      return t('betterAuth.errors.phoneExists');
    }
    case 'OTP expired':
    case 'OTP not found': {
      return t('betterAuth.errors.otpExpired');
    }
    case 'Too many attempts': {
      return t('betterAuth.errors.otpTooManyAttempts');
    }
    default: {
      return error;
    }
  }
};

export const postPhoneAuth = async (
  t: AuthTranslate,
  path: string,
  body: Record<string, unknown>,
): Promise<PhoneAuthResult> => {
  try {
    const response = await fetch(`/api/auth${path}`, {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const errorMessageRaw =
        data?.message || data?.error?.message || data?.code || t('betterAuth.signin.error');
      const errorMessage =
        typeof errorMessageRaw === 'string' ? errorMessageRaw : t('betterAuth.signin.error');

      return {
        errorMessage: getPhoneAuthErrorMessage(t, errorMessage),
        success: false,
      };
    }

    return { data, success: true };
  } catch (error) {
    console.error(`[phone-auth:${path}]`, error);

    return {
      errorMessage: t('betterAuth.signin.error'),
      success: false,
    };
  }
};
