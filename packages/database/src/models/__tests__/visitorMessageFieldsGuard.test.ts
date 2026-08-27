import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { VISITOR_MESSAGE_CLASSIFIED_KEYS } from '../message';

/**
 * Structural guard for `message.ts`'s visitor DTO field classification.
 *
 * `toVisitorMessage` builds the agent-share visitor DTO from an explicit
 * allowlist (`VISITOR_MESSAGE_ALLOWED_KEYS`) plus a small set of
 * denied/specially-handled keys — see that constant's JSDoc for why this is
 * allowlist-, not denylist-, shaped. That only fails closed for FUTURE
 * `UIChatMessage` fields if something actually checks that every field is
 * classified: without this guard, a field added to the interface and left
 * out of all three lists is silently absent from the visitor DTO (safe) OR
 * — if a future refactor of `toVisitorMessage` ever moves back to a spread +
 * strip shape — silently present (the exact bug this file was written to
 * catch, since `model`/`provider` leaked exactly that way despite a
 * regression test that claimed the snapshot was redacted).
 *
 * This test parses the `UIChatMessage` interface source directly (no type
 * reflection exists at runtime) and fails if any top-level field is not one
 * of: allowed, denied, or specially-handled in `message.ts`. A newly added
 * field therefore forces a human to explicitly classify it here instead of
 * inheriting a default.
 */
const UI_CHAT_MESSAGE_SOURCE_PATH = path.join(
  __dirname,
  '../../../../types/src/message/ui/chat.ts',
);

/** Extract the `{ ... }` body of `export interface <name> { ... }`, brace-depth aware. */
const extractInterfaceBody = (source: string, interfaceName: string): string => {
  const marker = `export interface ${interfaceName} {`;
  const startIndex = source.indexOf(marker);
  if (startIndex === -1) throw new Error(`Could not find interface ${interfaceName}`);

  let depth = 0;
  let bodyStart = -1;
  for (let i = startIndex; i < source.length; i++) {
    const char = source[i];
    if (char === '{') {
      depth++;
      if (depth === 1) bodyStart = i + 1;
    } else if (char === '}') {
      depth--;
      if (depth === 0) return source.slice(bodyStart, i);
    }
  }
  throw new Error(`Unterminated interface ${interfaceName}`);
};

/**
 * Field names declared directly on the interface (depth 0 within its body).
 * Tracks brace/bracket/paren depth per line so multi-line nested types (e.g.
 * `pinnedMessages?: { ... }[]`) contribute exactly one field name, not one
 * per inner line.
 */
const extractTopLevelFieldNames = (body: string): string[] => {
  const names: string[] = [];
  let depth = 0;

  for (const line of body.split('\n')) {
    if (depth === 0) {
      const match = line.match(/^\s*(?:\/\*\*.*\*\/\s*)?([a-z_]\w*)\??:/i);
      if (match) names.push(match[1]);
    }
    for (const char of line) {
      if (char === '{' || char === '[' || char === '(') depth++;
      else if (char === '}' || char === ']' || char === ')') depth--;
    }
  }

  return names;
};

describe('visitor message fields guard', () => {
  it('classifies every UIChatMessage field as allowed, denied, or specially handled', () => {
    const source = readFileSync(UI_CHAT_MESSAGE_SOURCE_PATH, 'utf8');
    const body = extractInterfaceBody(source, 'UIChatMessage');
    const declaredFields = extractTopLevelFieldNames(body);

    // Sanity check on the parser itself: if this drops below a known floor,
    // the regex/brace-depth walk broke silently instead of just missing a
    // genuinely new field.
    expect(declaredFields.length).toBeGreaterThanOrEqual(30);

    const classified = new Set(VISITOR_MESSAGE_CLASSIFIED_KEYS);
    const unclassified = declaredFields.filter((field) => !classified.has(field));

    expect(unclassified).toEqual([]);
  });
});
