import type { LiteralValue } from '../extract';

export const SAMPLE_TEXT = 'Ag 文本 Text';

export const VOID_TAGS = new Set([
  'area',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'source',
  'wbr',
]);

export const keepLiteral = (name: string, substituted: boolean) => {
  if (name === 'key' || name === 'ref' || /^on[A-Z]/.test(name)) return false;
  return substituted ? /^(?:data-|aria-|role$|style$)/.test(name) : true;
};

export const renderLiteral = (name: string, value: LiteralValue) =>
  typeof value === 'string'
    ? `${name}=${JSON.stringify(value)}`
    : `${name}={${JSON.stringify(value)}}`;
