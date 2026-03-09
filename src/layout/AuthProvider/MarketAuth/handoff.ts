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

export const persistMarketAuthResult = (payload: MarketAuthHandoffPayload) => {
  if (!isBrowser() || !payload.state) return;

  localStorage.setItem(getMarketAuthResultStorageKey(payload.state), JSON.stringify(payload));
};

export const readMarketAuthResult = (state: string): MarketAuthHandoffPayload | null => {
  if (!isBrowser()) return null;

  const rawValue = localStorage.getItem(getMarketAuthResultStorageKey(state));
  if (!rawValue) return null;

  try {
    return resolveMarketAuthHandoffPayload(JSON.parse(rawValue));
  } catch {
    return null;
  }
};

export const clearMarketAuthResult = (state: string) => {
  if (!isBrowser()) return;

  localStorage.removeItem(getMarketAuthResultStorageKey(state));
};
