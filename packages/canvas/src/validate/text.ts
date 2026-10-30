import type { CanvasIssue } from './types';

const NETWORK_PATTERNS: [RegExp, string][] = [
  [/\bfetch\s*\(/, 'fetch()'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\bWebSocket\b/, 'WebSocket'],
  [/\bEventSource\b/, 'EventSource'],
  [/\bsendBeacon\b/, 'navigator.sendBeacon'],
  [/\bimportScripts\s*\(/, 'importScripts()'],
  [/\bimport\s*\(\s*["'`](?:https?:)?\/\//, 'remote import()'],
  [/\bfrom\s*["'](?:https?:)?\/\//, 'remote import'],
];

export const lineAt = (text: string, index: number) => {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
};

export const checkScriptText = (file: string, text: string, lineOffset = 1): CanvasIssue[] => {
  const issues: CanvasIssue[] = [];

  for (const [pattern, name] of NETWORK_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    issues.push({
      file,
      line: lineOffset + lineAt(text, match.index) - 1,
      message: `${name} is not available: a Canvas has no network access. Embed the data in the project (inline JSON or a .json file) instead.`,
      rule: 'network-api',
    });
  }

  return issues;
};

const CSS_URL_PATTERN = /url\(\s*(["']?)([^\s"'()]+)\1\s*\)/g;
const CSS_IMPORT_PATTERN = /@import\s+(["'])([^"']+)\1/g;

export const collectCssRefs = (text: string): { href: string; index: number }[] => {
  const refs: { href: string; index: number }[] = [];
  for (const pattern of [CSS_URL_PATTERN, CSS_IMPORT_PATTERN]) {
    for (const match of text.matchAll(pattern)) refs.push({ href: match[2], index: match.index });
  }
  return refs;
};

const COLOR_PROPERTY = /color|background|border|fill|stroke|shadow|outline/;
const COLOR_LITERAL =
  /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(|\b(?:black|white|red|green|blue|yellow|orange|purple|pink|gray|grey|brown|cyan|magenta)\b/i;

export const findHardCodedColor = (style: string): string | undefined => {
  for (const declaration of style.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon === -1) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim();
    if (COLOR_PROPERTY.test(property) && COLOR_LITERAL.test(value)) return declaration.trim();
  }
};
