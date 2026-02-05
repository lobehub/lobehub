import { useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

type HistoryMode = 'push' | 'replace';

// Options interface for useQueryParam hook
interface QueryParamOptions<T> {
  clearOnDefault?: boolean;
  defaultValue?: T;
  history?: HistoryMode;
  throttleMs?: number;
}

// Parser interface
interface Parser<T> {
  parse: (value: string | null) => T;
  serialize: (value: T) => string | null;
}

// Parser interface with default value
interface ParserWithDefault<T> extends Parser<T> {
  // nuqs has an optional default value on parsers
  defaultValue?: T;
  parse: (value: string | null) => T;
}

/**
 * Core hook for managing a single query parameter
 * Replaces nuqs's useQueryState functionality for react-router-dom
 */
export function useQueryParam<T>(
  key: string,
  parser: Parser<T> | ParserWithDefault<T>,
  options: QueryParamOptions<T> = {},
): [T, (value: T | ((prev: T) => T)) => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  // Extract defaultValue from options or parser itself
  const {
    clearOnDefault = false,
    defaultValue = (parser as ParserWithDefault<T>)?.defaultValue,
    history = 'push',
    throttleMs = 0,
  } = options;

   
  const throttleTimer = useRef<NodeJS.Timeout | null>(null);
  const lastExecuteTime = useRef<number>(0);

  // Use ref to store latest values, keeping setValue stable
  const searchParamsRef = useRef(searchParams);
  const parserRef = useRef(parser);
  const defaultValueRef = useRef(defaultValue);
  const clearOnDefaultRef = useRef(clearOnDefault);
  const historyRef = useRef(history);

  // Update refs on every render
  useEffect(() => {
    searchParamsRef.current = searchParams;
    parserRef.current = parser;
    defaultValueRef.current = defaultValue;
    clearOnDefaultRef.current = clearOnDefault;
    historyRef.current = history;
  });

  // Parse current value from URL
  const currentValue = parser.parse(searchParams.get(key));
  const value = currentValue ?? (defaultValue as T);

  // setValue is now stable and won't be recreated when searchParams changes
  const setValue = useCallback(
    (newValue: T | ((prev: T) => T)) => {
      // Read latest values from refs to avoid stale closure issues
      const currentSearchParams = searchParamsRef.current;
      const currentParser = parserRef.current;
      const currentDefaultValue = defaultValueRef.current;
      const currentClearOnDefault = clearOnDefaultRef.current;
      const currentHistory = historyRef.current;

      // Get latest value through function form
      const currentVal =
        currentParser.parse(currentSearchParams.get(key)) ?? (currentDefaultValue as T);
      const actualValue =
        typeof newValue === 'function' ? (newValue as (prev: T) => T)(currentVal) : newValue;

      const updateParams = () => {
        // Use functional update to ensure it's based on latest searchParams
        setSearchParams(
          (prevParams) => {
            const newSearchParams = new URLSearchParams(prevParams);
            const serialized = currentParser.serialize(actualValue);

            // Handle clearOnDefault option
            if (
              currentClearOnDefault &&
              currentDefaultValue !== undefined &&
              serialized === currentParser.serialize(currentDefaultValue as T)
            ) {
              newSearchParams.delete(key);
            } else if (serialized === null || serialized === undefined) {
              newSearchParams.delete(key);
            } else {
              newSearchParams.set(key, serialized);
            }

            return newSearchParams;
          },
          { replace: currentHistory === 'replace' },
        );
      };

      // Handle throttling
      if (throttleMs > 0) {
        const now = Date.now();
        const timeSinceLastExecute = now - lastExecuteTime.current;

        if (timeSinceLastExecute >= throttleMs) {
          // Throttle time exceeded since last execution, execute immediately
          lastExecuteTime.current = now;
          updateParams();
          // Clear any existing timer
          if (throttleTimer.current) {
            clearTimeout(throttleTimer.current);
            throttleTimer.current = null;
          }
        } else {
          // Still within throttle period, set timer to execute one last time after remaining time
          if (throttleTimer.current) {
            clearTimeout(throttleTimer.current);
          }
          const remainingTime = throttleMs - timeSinceLastExecute;
          throttleTimer.current = setTimeout(() => {
            lastExecuteTime.current = Date.now();
            updateParams();
            throttleTimer.current = null;
          }, remainingTime);
        }
      } else {
        updateParams();
      }
    },
    [key, setSearchParams, throttleMs], // Only depend on values that don't change frequently
  );

  // Clean up throttle timer on component unmount
  useEffect(() => {
    return () => {
      if (throttleTimer.current) {
        clearTimeout(throttleTimer.current);
      }
    };
  }, []);

  return [value, setValue];
}

// ===== Parsers =====

/**
 * String parser - default behavior
 */
export const parseAsString: Parser<string | null> & {
  withDefault: (defaultValue: string) => ParserWithDefault<string>;
} = {
  parse: (value: string | null) => value,
  serialize: (value: string | null) => value,
  withDefault: (defaultValue: string) => ({
    defaultValue,
    parse: (value: string | null) => value ?? defaultValue,
    serialize: (value: string) => value,
  }),
};

/**
 * Boolean parser
 */
export const parseAsBoolean: Parser<boolean | null> & {
  withDefault: (defaultValue: boolean) => ParserWithDefault<boolean>;
} = {
  parse: (value: string | null) => {
    if (value === null) return null;
    return value === 'true' || value === '1';
  },
  serialize: (value: boolean | null) => {
    if (value === null) return null;
    return value ? 'true' : 'false';
  },
  withDefault: (defaultValue: boolean) => ({
    defaultValue,
    parse: (value: string | null) => {
      if (value === null) return defaultValue;
      return value === 'true' || value === '1';
    },
    serialize: (value: boolean) => (value ? 'true' : 'false'),
  }),
};

/**
 * Integer parser
 */
export const parseAsInteger: Parser<number | null> & {
  withDefault: (defaultValue: number) => ParserWithDefault<number>;
} = {
  parse: (value: string | null) => {
    if (value === null) return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  },
  serialize: (value: number | null) => {
    if (value === null) return null;
    return value.toString();
  },
  withDefault: (defaultValue: number) => ({
    defaultValue,
    parse: (value: string | null) => {
      if (value === null) return defaultValue;
      const parsed = Number.parseInt(value, 10);
      return Number.isNaN(parsed) ? defaultValue : parsed;
    },
    serialize: (value: number) => value.toString(),
  }),
};

/**
 * String enum parser
 */
export function parseAsStringEnum<T extends string>(validValues: readonly T[]) {
  const parser: Parser<T | null> = {
    parse: (value: string | null): T | null => {
      if (value === null) return null;
      return validValues.includes(value as T) ? (value as T) : null;
    },
    serialize: (value: T | null) => value,
  };

  const withDefault = (defaultValue: T): ParserWithDefault<T> => ({
    defaultValue,
    parse: (value: string | null): T => {
      if (value === null) return defaultValue;
      return validValues.includes(value as T) ? (value as T) : defaultValue;
    },
    serialize: (value: T) => value,
  });

  return Object.assign(parser, { withDefault });
}

// ===== Simplified API =====

// --- Overload Signatures ---

// String (no parser or only options)
export function useQueryState(
  key: string,
  options?: QueryParamOptions<string | null>,
): [string | null, (value: string | null | ((prev: string | null) => string | null)) => void];

// String parser with default value
 
export function useQueryState(
  key: string,
  parserWithDefault: ParserWithDefault<string>,
): [string, (value: string | ((prev: string) => string)) => void];

// Boolean parser
 
export function useQueryState(
  key: string,
  parser: typeof parseAsBoolean,
): [boolean | null, (value: boolean | null | ((prev: boolean | null) => boolean | null)) => void];

// Boolean parser with default value
 
export function useQueryState(
  key: string,
  parserWithDefault: ParserWithDefault<boolean>,
): [boolean, (value: boolean | ((prev: boolean) => boolean)) => void];

// Integer parser
 
export function useQueryState(
  key: string,
  parser: typeof parseAsInteger,
): [number | null, (value: number | null | ((prev: number | null) => number | null)) => void];

// Integer parser with default value
 
export function useQueryState(
  key: string,
  parserWithDefault: ParserWithDefault<number>,
): [number, (value: number | ((prev: number) => number)) => void];

// String enum parser with default value
 
export function useQueryState<T extends string>(
  key: string,
  parserWithDefault: ParserWithDefault<T>,
): [T, (value: T | ((prev: T) => T)) => void];

// --- Single Implementation ---
 
export function useQueryState(key: string, parserOrOptions?: any): any {
  // Fixed logic dispatch issue
  let parser: Parser<any>;
  let options: QueryParamOptions<any> = {};

  if (!parserOrOptions) {
    // Scenario 1: useQueryState('key')
    parser = parseAsString;
  } else if (typeof parserOrOptions.parse === 'function') {
    // Scenario 2: useQueryState('key', parseAsInteger) or useQueryState('key', parseAsInteger.withDefault(10))
    parser = parserOrOptions;
    // Extract options from parser itself (e.g. defaultValue)
    options = parserOrOptions;
  } else {
    // Scenario 3: useQueryState('key', { defaultValue: 'foo', throttleMs: 500 })
    parser = parseAsString;
    options = parserOrOptions;
  }

  return useQueryParam(key, parser, options);
}
