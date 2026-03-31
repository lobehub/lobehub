interface MarketAuthSuccessHandoffPayload {
  code: string;
  state: string;
  type: 'MARKET_AUTH_SUCCESS';
}

interface MarketAuthErrorHandoffPayload {
  error: string;
  state?: string;
  type: 'MARKET_AUTH_ERROR';
}

export type MarketAuthHandoffPayload =
  | MarketAuthErrorHandoffPayload
  | MarketAuthSuccessHandoffPayload;

const MARKET_AUTH_RESULT_STORAGE_PREFIX = 'market_auth_result:';

const isBrowser = () => typeof window !== 'undefined';

export const getMarketAuthResultStorageKey = (state: string) =>
  `${MARKET_AUTH_RESULT_STORAGE_PREFIX}${state}`;

export const resolveMarketAuthHandoffPayload = (
  value: unknown,
): MarketAuthHandoffPayload | null => {
  if (!value || typeof value !== 'object') return null;

  const payload = value as Partial<MarketAuthHandoffPayload>;

  if (payload.type === 'MARKET_AUTH_SUCCESS') {
    if (typeof payload.code !== 'string' || typeof payload.state !== 'string') return null;

    return {
      code: payload.code,
      state: payload.state,
      type: payload.type,
    };
  }

  if (payload.type === 'MARKET_AUTH_ERROR') {
    if (typeof payload.error !== 'string') return null;

    return {
      error: payload.error,
      state: typeof payload.state === 'string' ? payload.state : undefined,
      type: payload.type,
    };
  }

  return null;
};

export const persistMarketAuthResult = (payload: MarketAuthHandoffPayload): boolean => {
  if (!isBrowser() || !payload.state) return false;

  try {
    localStorage.setItem(getMarketAuthResultStorageKey(payload.state), JSON.stringify(payload));
    return true;
  } catch (error) {
    console.error('[MarketAuthHandoff] Failed to persist auth result:', error);
    return false;
  }
};

export const readMarketAuthResult = (state: string): MarketAuthHandoffPayload | null => {
  if (!isBrowser()) return null;

  try {
    const rawValue = localStorage.getItem(getMarketAuthResultStorageKey(state));
    if (!rawValue) return null;

    return resolveMarketAuthHandoffPayload(JSON.parse(rawValue));
  } catch (error) {
    console.error('[MarketAuthHandoff] Failed to read auth result:', error);
    return null;
  }
};

export const clearMarketAuthResult = (state: string): boolean => {
  if (!isBrowser()) return false;

  try {
    localStorage.removeItem(getMarketAuthResultStorageKey(state));
    return true;
  } catch (error) {
    console.error('[MarketAuthHandoff] Failed to clear auth result:', error);
    return false;
  }
};
