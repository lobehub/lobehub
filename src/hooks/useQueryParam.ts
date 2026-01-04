import { useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

type HistoryMode = 'push' | 'replace';

// options 接口，用于 useQueryParam hook
interface QueryParamOptions<T> {
  clearOnDefault?: boolean;
  defaultValue?: T;
  history?: HistoryMode;
  throttleMs?: number;
}

// 解析器接口
interface Parser<T> {
  parse: (value: string | null) => T;
  serialize: (value: T) => string | null;
}

// 带默认值的解析器接口
interface ParserWithDefault<T> extends Parser<T> {
  // nuqs has an optional default value on parsers
  defaultValue?: T;
  parse: (value: string | null) => T;
}

/**
 * 核心钩子，用于管理单个查询参数
 * 为 react-router-dom 替换 nuqs 的 useQueryState 功能
 */
export function useQueryParam<T>(
  key: string,
  parser: Parser<T> | ParserWithDefault<T>,
  options: QueryParamOptions<T> = {},
): [T, (value: T | ((prev: T) => T)) => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  // 从 options 或 parser 本身提取 defaultValue
  const {
    clearOnDefault = false,
    defaultValue = (parser as ParserWithDefault<T>)?.defaultValue,
    history = 'push',
    throttleMs = 0,
  } = options;

  // eslint-disable-next-line no-undef
  const throttleTimer = useRef<NodeJS.Timeout | null>(null);
  const lastExecuteTime = useRef<number>(0);

  // 使用 ref 存储最新的值，让 setValue 保持稳定
  const searchParamsRef = useRef(searchParams);
  const parserRef = useRef(parser);
  const defaultValueRef = useRef(defaultValue);
  const clearOnDefaultRef = useRef(clearOnDefault);
  const historyRef = useRef(history);

  // 每次渲染时更新 ref
  useEffect(() => {
    searchParamsRef.current = searchParams;
    parserRef.current = parser;
    defaultValueRef.current = defaultValue;
    clearOnDefaultRef.current = clearOnDefault;
    historyRef.current = history;
  });

  // 从 URL 解析当前值
  const currentValue = parser.parse(searchParams.get(key));
  const value = currentValue ?? (defaultValue as T);

  // setValue 现在是稳定的，不会因为 searchParams 变化而重新创建
  const setValue = useCallback(
    (newValue: T | ((prev: T) => T)) => {
      // 从 ref 读取最新值，避免闭包陈旧值问题
      const currentSearchParams = searchParamsRef.current;
      const currentParser = parserRef.current;
      const currentDefaultValue = defaultValueRef.current;
      const currentClearOnDefault = clearOnDefaultRef.current;
      const currentHistory = historyRef.current;

      // 通过函数形式获取最新值
      const currentVal =
        currentParser.parse(currentSearchParams.get(key)) ?? (currentDefaultValue as T);
      const actualValue =
        typeof newValue === 'function' ? (newValue as (prev: T) => T)(currentVal) : newValue;

      const updateParams = () => {
        // 使用函数式更新，确保基于最新的 searchParams
        setSearchParams(
          (prevParams) => {
            const newSearchParams = new URLSearchParams(prevParams);
            const serialized = currentParser.serialize(actualValue);

            // 处理 clearOnDefault 选项
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

      // 处理节流
      if (throttleMs > 0) {
        const now = Date.now();
        const timeSinceLastExecute = now - lastExecuteTime.current;

        if (timeSinceLastExecute >= throttleMs) {
          // 距离上次执行已超过节流时间，立即执行
          lastExecuteTime.current = now;
          updateParams();
          // 清理可能存在的定时器
          if (throttleTimer.current) {
            clearTimeout(throttleTimer.current);
            throttleTimer.current = null;
          }
        } else {
          // 还在节流期内，设置定时器在剩余时间后执行最后一次
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
    [key, setSearchParams, throttleMs], // 只依赖不会频繁变化的值
  );

  // 组件卸载时清理节流计时器
  useEffect(() => {
    return () => {
      if (throttleTimer.current) {
        clearTimeout(throttleTimer.current);
      }
    };
  }, []);

  return [value, setValue];
}

// ===== 解析器 (Parsers) =====

/**
 * 字符串解析器 - 默认行为
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
 * 布尔值解析器
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
 * 整数解析器
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
 * 字符串枚举解析器
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

// ===== 简化的 API (Simplified API) =====

// --- 重载签名 ---

// 字符串 (无解析器或仅有 options)
export function useQueryState(
  key: string,
  options?: QueryParamOptions<string | null>,
): [string | null, (value: string | null | ((prev: string | null) => string | null)) => void];

// 带默认值的字符串解析器
// eslint-disable-next-line no-redeclare
export function useQueryState(
  key: string,
  parserWithDefault: ParserWithDefault<string>,
): [string, (value: string | ((prev: string) => string)) => void];

// 布尔值解析器
// eslint-disable-next-line no-redeclare
export function useQueryState(
  key: string,
  parser: typeof parseAsBoolean,
): [boolean | null, (value: boolean | null | ((prev: boolean | null) => boolean | null)) => void];

// 带默认值的布尔值解析器
// eslint-disable-next-line no-redeclare
export function useQueryState(
  key: string,
  parserWithDefault: ParserWithDefault<boolean>,
): [boolean, (value: boolean | ((prev: boolean) => boolean)) => void];

// 整数解析器
// eslint-disable-next-line no-redeclare
export function useQueryState(
  key: string,
  parser: typeof parseAsInteger,
): [number | null, (value: number | null | ((prev: number | null) => number | null)) => void];

// 带默认值的整数解析器
// eslint-disable-next-line no-redeclare
export function useQueryState(
  key: string,
  parserWithDefault: ParserWithDefault<number>,
): [number, (value: number | ((prev: number) => number)) => void];

// 带默认值的字符串枚举解析器
// eslint-disable-next-line no-redeclare
export function useQueryState<T extends string>(
  key: string,
  parserWithDefault: ParserWithDefault<T>,
): [T, (value: T | ((prev: T) => T)) => void];

// --- 单一实现 ---
// eslint-disable-next-line no-redeclare
export function useQueryState(key: string, parserOrOptions?: any): any {
  // 修复了逻辑分派问题
  let parser: Parser<any>;
  let options: QueryParamOptions<any> = {};

  if (!parserOrOptions) {
    // 场景 1: useQueryState('key')
    parser = parseAsString;
  } else if (typeof parserOrOptions.parse === 'function') {
    // 场景 2: useQueryState('key', parseAsInteger) 或 useQueryState('key', parseAsInteger.withDefault(10))
    parser = parserOrOptions;
    // 从解析器自身提取 options (例如 defaultValue)
    options = parserOrOptions;
  } else {
    // 场景 3: useQueryState('key', { defaultValue: 'foo', throttleMs: 500 })
    parser = parseAsString;
    options = parserOrOptions;
  }

  return useQueryParam(key, parser, options);
}
