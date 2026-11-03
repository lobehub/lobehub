export type MarketAuthErrorCode =
  | 'authorizationFailed'
  | 'browserOnly'
  | 'codeConsumed'
  | 'codeVerifierMissing'
  | 'general'
  | 'handoffFailed'
  | 'handoffTimeout'
  | 'oidcNotReady'
  | 'openBrowserFailed'
  | 'openPopupFailed'
  | 'popupClosed'
  | 'sessionExpired'
  | 'stateMissing'
  | 'stateMismatch';

interface MarketAuthErrorOptions {
  cause?: unknown;
  message?: string;
  meta?: Record<string, unknown>;
}

export class MarketAuthError extends Error {
  public readonly code: MarketAuthErrorCode;

  public readonly meta?: Record<string, unknown>;

  constructor(code: MarketAuthErrorCode, options: MarketAuthErrorOptions = {}) {
    super(options.message ?? code);
    this.name = 'MarketAuthError';
    this.code = code;
    this.meta = options.meta;

    if (options.cause) {
      this.cause = options.cause;
    }
  }
}

const PATTERN_CODE_MAP: Array<[RegExp, MarketAuthErrorCode]> = [
  [/authorization can only be initiated in a browser environment/i, 'browserOnly'],
  [/authorization code already consumed/i, 'codeConsumed'],
  [/authorization popup was closed/i, 'popupClosed'],
  [/authorization session expired/i, 'sessionExpired'],
  [/authorization state not found/i, 'stateMissing'],
  [/state mismatch/i, 'stateMismatch'],
  [/code verifier not found/i, 'codeVerifierMissing'],
  [/failed to open authorization popup/i, 'openPopupFailed'],
  [/failed to open system browser/i, 'openBrowserFailed'],
  [/oidc client not initialized/i, 'oidcNotReady'],
  [/failed to retrieve authorization result from handoff endpoint/i, 'handoffFailed'],
  [/invalid state parameter/i, 'stateMismatch'],
  [/timeout/i, 'handoffTimeout'],
];

export const resolveMarketAuthError = (error: unknown): MarketAuthError => {
  if (error instanceof MarketAuthError) {
    return error;
  }

  if (error instanceof Error) {
    const matchedPattern = PATTERN_CODE_MAP.find(([pattern]) => pattern.test(error.message));

    if (matchedPattern) {
      return new MarketAuthError(matchedPattern[1], { cause: error });
    }

    return new MarketAuthError('authorizationFailed', {
      cause: error,
      meta: { message: error.message },
    });
  }

  return new MarketAuthError('general');
};
