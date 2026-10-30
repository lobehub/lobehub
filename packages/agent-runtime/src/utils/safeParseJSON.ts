import { parse } from 'partial-json';

export const safeParseJSON = <T = Record<string, any>>(text?: string) => {
  if (typeof text !== 'string') return undefined;

  let json: T;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }

  return json;
};

export const safeParsePartialJSON = <T = Record<string, any>>(text?: string): T | undefined => {
  try {
    return parse(text || '{}') as T;
  } catch {
    return undefined;
  }
};
