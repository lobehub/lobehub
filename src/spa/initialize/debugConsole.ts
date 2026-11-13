import debug from 'debug';

const MAX_VALUE_LENGTH = 2000;

const stringifyObject = (value: object) => {
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  const seen = new WeakSet<object>();
  try {
    const json = JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item === 'bigint') return `${item}n`;
      if (typeof item === 'object' && item !== null) {
        if (seen.has(item)) return '[Circular]';
        seen.add(item);
      }
      return item;
    });
    return json ?? String(value);
  } catch {
    return String(value);
  }
};

const stringifyValue = (value: unknown): string => {
  const text = typeof value === 'object' && value !== null ? stringifyObject(value) : String(value);
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text;
};

const toInteger = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.trunc(number)) : 'NaN';
};

/**
 * Formats console arguments the way DevTools renders them, as one plain line:
 * `%s` / `%d` / `%i` / `%f` / `%o` / `%O` / `%j` take the next argument, `%c` drops
 * its CSS argument, `%%` is a literal `%`, and leftover arguments are appended.
 */
export const formatConsoleArgs = (args: unknown[]): string => {
  const [first, ...rest] = args;
  if (typeof first !== 'string') return args.map(stringifyValue).join(' ');

  let index = 0;
  const text = first.replaceAll(/%([%Ocdfijos])/g, (match, specifier: string) => {
    if (specifier === '%') return '%';
    if (index >= rest.length) return match;
    const value = rest[index++];
    switch (specifier) {
      case 'c': {
        return '';
      }
      case 'd':
      case 'i': {
        return toInteger(value);
      }
      case 'f': {
        return String(Number(value));
      }
      default: {
        return stringifyValue(value);
      }
    }
  });

  return [text, ...rest.slice(index).map(stringifyValue)].join(' ');
};

/**
 * Desktop only: the main process records every renderer console line into
 * `renderer.jsonl` from Electron's `console-message` event, which carries the raw
 * format string and its arguments joined by spaces (`%clobe-store %c… %s color: …`).
 * The argument boundaries are gone by then, so `debug` output is formatted here,
 * before it reaches the console. DevTools shows these lines without colors.
 */
export const installPlainDebugConsole = (target: Pick<typeof debug, 'log'> = debug) => {
  target.log = (...args: unknown[]) => {
    // eslint-disable-next-line no-console
    console.debug(formatConsoleArgs(args));
  };
};
